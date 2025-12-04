/**
 * Chat Memory Service
 * Manages conversation context and memory for AI interactions
 * Supports Chat Mode (planning) and Agent Mode (implementation)
 */

import { db } from '@/db';
import { conversations, messages } from '@/db/schema';
import { eq } from 'drizzle-orm';

export type ChatMode = 'chat' | 'agent';

export interface ConversationContext {
  id: string;
  projectId: string;
  mode: ChatMode;
  summary?: string;
  requirements?: ProjectRequirements;
  history: ConversationMessage[];
  createdAt: Date;
}

export interface ProjectRequirements {
  projectType?: string;
  features?: string[];
  styling?: string;
  pages?: string[];
  techStack?: string[];
  additionalNotes?: string;
  confirmed?: boolean;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  mode?: ChatMode;
  timestamp: Date;
  metadata?: {
    filesCreated?: string[];
    requirementsUpdated?: boolean;
    modeSwitch?: boolean;
  };
}

export interface MemoryLane {
  shortTermMemory: ConversationMessage[]; // Recent messages (last 10)
  longTermSummary: string | null; // Summary of older conversation
  requirements: ProjectRequirements | null;
  conversationSummary: string | null;
  keyDecisions: string[];
  implementedFeatures: string[];
  recentFiles: string[]; // Recently created/modified files
  contextWindow: number; // Total context tokens used
}

/**
 * Build a memory lane from conversation history
 * This gives the AI context about what has been discussed and implemented
 */
export function buildMemoryLane(history: ConversationMessage[]): MemoryLane {
  // Keep more recent messages for better context (last 15 instead of 10)
  const shortTermMemory = history.slice(-15);
  
  // Generate summary of older conversation (if more than 15 messages)
  const olderMessages = history.slice(0, -15);
  const longTermSummary = olderMessages.length > 0 
    ? generateDetailedSummary(olderMessages) 
    : null;
  
  // Extract requirements from conversation
  const requirements = extractRequirements(history);
  
  // Generate summary of earlier conversation (legacy)
  const conversationSummary = generateSummary(history.slice(0, -15));
  
  // Extract key decisions
  const keyDecisions = extractKeyDecisions(history);
  
  // Track what's been implemented
  const implementedFeatures = extractImplementedFeatures(history);
  
  // Track recently created files
  const recentFiles = extractRecentFiles(history);
  
  // Estimate context window usage
  const contextWindow = estimateTokens(shortTermMemory, requirements, keyDecisions);
  
  return {
    shortTermMemory,
    longTermSummary,
    requirements,
    conversationSummary,
    keyDecisions,
    implementedFeatures,
    recentFiles,
    contextWindow,
  };
}

/**
 * Extract project requirements from conversation
 */
function extractRequirements(history: ConversationMessage[]): ProjectRequirements | null {
  const requirements: ProjectRequirements = {};
  
  for (const msg of history) {
    const content = msg.content.toLowerCase();
    
    // Detect project type
    if (content.includes('blog') || content.includes('personal blog')) {
      requirements.projectType = 'blog';
    } else if (content.includes('portfolio')) {
      requirements.projectType = 'portfolio';
    } else if (content.includes('e-commerce') || content.includes('shop') || content.includes('store')) {
      requirements.projectType = 'e-commerce';
    } else if (content.includes('dashboard')) {
      requirements.projectType = 'dashboard';
    } else if (content.includes('landing page')) {
      requirements.projectType = 'landing-page';
    }
    
    // Detect pages
    if (!requirements.pages) requirements.pages = [];
    if (content.includes('contact page') || content.includes('contact form')) {
      if (!requirements.pages.includes('contact')) requirements.pages.push('contact');
    }
    if (content.includes('about page') || content.includes('about me')) {
      if (!requirements.pages.includes('about')) requirements.pages.push('about');
    }
    if (content.includes('home page')) {
      if (!requirements.pages.includes('home')) requirements.pages.push('home');
    }
    
    // Detect styling preferences
    if (content.includes('modern') || content.includes('minimalist')) {
      requirements.styling = 'modern-minimalist';
    } else if (content.includes('classic') || content.includes('traditional')) {
      requirements.styling = 'classic';
    } else if (content.includes('colorful') || content.includes('vibrant')) {
      requirements.styling = 'colorful';
    } else if (content.includes('dark mode') || content.includes('dark theme')) {
      requirements.styling = 'dark-mode';
    }
    
    // Detect features
    if (!requirements.features) requirements.features = [];
    if (content.includes('newsletter') || content.includes('subscribe')) {
      if (!requirements.features.includes('newsletter')) requirements.features.push('newsletter');
    }
    if (content.includes('comment') || content.includes('discussion')) {
      if (!requirements.features.includes('comments')) requirements.features.push('comments');
    }
    if (content.includes('search')) {
      if (!requirements.features.includes('search')) requirements.features.push('search');
    }
    if (content.includes('authentication') || content.includes('login') || content.includes('sign up')) {
      if (!requirements.features.includes('auth')) requirements.features.push('auth');
    }
    
    // Check for confirmation
    if (msg.role === 'user' && 
        (content.includes('yes') || content.includes('correct') || 
         content.includes('perfect') || content.includes('go ahead') ||
         content.includes('start building') || content.includes('implement'))) {
      requirements.confirmed = true;
    }
  }
  
  return Object.keys(requirements).length > 0 ? requirements : null;
}

/**
 * Generate a summary of earlier conversation
 */
function generateSummary(messages: ConversationMessage[]): string | null {
  if (messages.length === 0) return null;
  
  const userMessages = messages.filter(m => m.role === 'user');
  const topics = userMessages.map(m => m.content.slice(0, 100)).join('; ');
  
  return topics.length > 0 
    ? `Earlier discussion covered: ${topics.slice(0, 500)}...`
    : null;
}

/**
 * Generate a more detailed summary of older conversation
 */
function generateDetailedSummary(messages: ConversationMessage[]): string {
  if (messages.length === 0) return '';
  
  const summary: string[] = [];
  
  // Extract key topics from user messages
  const userTopics = messages
    .filter(m => m.role === 'user')
    .map(m => m.content.slice(0, 150))
    .slice(-5);
  
  if (userTopics.length > 0) {
    summary.push(`User discussed: ${userTopics.join('; ')}`);
  }
  
  // Extract what was created
  const filesCreated = messages
    .filter(m => m.role === 'assistant' && m.metadata?.filesCreated)
    .flatMap(m => m.metadata!.filesCreated || []);
  
  if (filesCreated.length > 0) {
    summary.push(`Files created: ${filesCreated.slice(-10).join(', ')}`);
  }
  
  // Detect mode switches
  const modeChanges = messages.filter(m => m.metadata?.modeSwitch);
  if (modeChanges.length > 0) {
    summary.push(`Mode switches: ${modeChanges.length}`);
  }
  
  return summary.join('. ');
}

/**
 * Extract recently created files from conversation
 */
function extractRecentFiles(history: ConversationMessage[]): string[] {
  const files: string[] = [];
  
  // Get files from last 10 assistant messages
  const recentAssistant = history
    .filter(m => m.role === 'assistant')
    .slice(-10);
  
  for (const msg of recentAssistant) {
    if (msg.metadata?.filesCreated) {
      files.push(...msg.metadata.filesCreated);
    }
  }
  
  // Return unique files, most recent first
  return [...new Set(files)].slice(-20);
}

/**
 * Estimate token usage for context window
 */
function estimateTokens(
  messages: ConversationMessage[],
  requirements: ProjectRequirements | null,
  decisions: string[]
): number {
  // Rough estimate: 1 token ≈ 4 characters
  let chars = 0;
  
  for (const msg of messages) {
    chars += msg.content.length;
  }
  
  if (requirements) {
    chars += JSON.stringify(requirements).length;
  }
  
  chars += decisions.join('').length;
  
  return Math.ceil(chars / 4);
}

/**
 * Extract key decisions from conversation
 */
function extractKeyDecisions(history: ConversationMessage[]): string[] {
  const decisions: string[] = [];
  
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (msg.role === 'user') {
      const content = msg.content.toLowerCase();
      
      // Look for decision indicators
      if (content.includes('let\'s go with') || 
          content.includes('i want') || 
          content.includes('i prefer') ||
          content.includes('use ') ||
          content.includes('yes, ')) {
        decisions.push(msg.content.slice(0, 150));
      }
    }
  }
  
  return decisions.slice(-5); // Keep last 5 decisions
}

/**
 * Extract implemented features from conversation
 */
function extractImplementedFeatures(history: ConversationMessage[]): string[] {
  const features: string[] = [];
  
  for (const msg of history) {
    if (msg.role === 'assistant' && msg.metadata?.filesCreated) {
      for (const file of msg.metadata.filesCreated) {
        if (file.includes('page.tsx') || file.includes('page.jsx')) {
          const pageName = file.split('/').pop()?.replace(/\.(tsx|jsx)$/, '');
          if (pageName && !features.includes(`Page: ${pageName}`)) {
            features.push(`Page: ${pageName}`);
          }
        } else if (file.includes('components/')) {
          const componentName = file.split('/').pop()?.replace(/\.(tsx|jsx)$/, '');
          if (componentName && !features.includes(`Component: ${componentName}`)) {
            features.push(`Component: ${componentName}`);
          }
        }
      }
    }
  }
  
  return features;
}

/**
 * Build system prompt based on mode and memory
 */
export function buildSystemPrompt(mode: ChatMode, memory: MemoryLane): string {
  if (mode === 'chat') {
    return buildChatModePrompt(memory);
  } else {
    return buildAgentModePrompt(memory);
  }
}

function buildChatModePrompt(memory: MemoryLane): string {
  let prompt = `# CHAT MODE - PLANNING & DISCUSSION ONLY

You are a friendly product consultant and planning assistant. Your ONLY job is to DISCUSS, PLAN, and EXPLAIN - you are NOT a code generator in this mode.

## ⛔ ABSOLUTE RESTRICTIONS - VIOLATING THESE IS FORBIDDEN

### YOU MUST NEVER:
- Generate ANY code (not even 1 line)
- Use code blocks (\`\`\`) for any reason
- Write file contents
- Show implementations, snippets, or examples in code format
- Respond to requests like "create", "build", "implement", "add", "fix", "update", "modify", "write", "code" with actual code
- Generate HTML, CSS, JavaScript, TypeScript, JSX, TSX, or any programming language syntax
- Use inline code for anything other than file names or simple technical terms

### IF USER ASKS FOR CODE OR IMPLEMENTATION:
Always respond with this EXACT message:
"I'm currently in **Chat Mode** 💬 which is designed for planning and discussion only. I cannot write or generate code in this mode.

To implement what we've discussed, please **switch to Agent Mode** 🤖 using the toggle button at the bottom of the chat, and I'll help bring your ideas to life with working code!"

## ✅ WHAT YOU CAN AND SHOULD DO:

### Planning & Requirements
- Ask clarifying questions about what the user wants to build
- Help define project scope, features, and priorities
- Discuss user flows and user experience
- Create feature lists and roadmaps in plain text

### Architecture Discussion (in words only)
- Discuss component structure conceptually (e.g., "You'll need a Navbar component that handles navigation")
- Explain design patterns in plain English
- Recommend technology choices with reasoning
- Discuss data models and relationships verbally

### Explaining Existing Code (read-only)
- Explain what existing code does when asked
- Describe the project structure
- Answer questions about the codebase
- Suggest improvements conceptually (without showing code)

### Product Strategy
- Help prioritize features
- Discuss MVP vs future features
- Talk about user needs and market fit

## Response Style
- Be conversational and friendly
- Keep responses concise (2-3 paragraphs max)
- Use bullet points for lists
- Focus on WHAT and WHY, never HOW (implementation details)
- End with a question to keep the conversation going
`;

  if (memory.requirements) {
    prompt += `\n## Current Understanding of Requirements\n`;
    if (memory.requirements.projectType) {
      prompt += `- Project Type: ${memory.requirements.projectType}\n`;
    }
    if (memory.requirements.pages?.length) {
      prompt += `- Pages: ${memory.requirements.pages.join(', ')}\n`;
    }
    if (memory.requirements.features?.length) {
      prompt += `- Features: ${memory.requirements.features.join(', ')}\n`;
    }
    if (memory.requirements.styling) {
      prompt += `- Styling: ${memory.requirements.styling}\n`;
    }
  }

  if (memory.keyDecisions.length > 0) {
    prompt += `\n## Key Decisions Made\n`;
    memory.keyDecisions.forEach(d => {
      prompt += `- ${d}\n`;
    });
  }

  if (memory.conversationSummary) {
    prompt += `\n## Earlier Conversation Summary\n${memory.conversationSummary}\n`;
  }

  prompt += `\n## Response Format
Keep responses SHORT and conversational (2-3 paragraphs max). Use bullet points for lists.

⛔ REMINDER: NO CODE, NO CODE BLOCKS, NO IMPLEMENTATIONS - EVER.
If asked for code, redirect to Agent Mode.

When requirements are clear, end with:
"We've got a solid plan! Ready to start building? **Switch to Agent Mode** 🤖 using the toggle, and I'll implement your ${memory.requirements?.projectType || 'project'} step by step!"`;

  return prompt;
}

function buildAgentModePrompt(memory: MemoryLane): string {
  let prompt = `# AGENT MODE - IMPLEMENTATION

You are an expert full-stack developer. Your job is to IMPLEMENT the features that were discussed in the planning phase.

## Your Role
- Generate high-quality, production-ready code
- Implement features systematically based on the conversation context
- Follow the requirements gathered in the planning phase
- Create well-structured, maintainable code
- Use modern React patterns and Tailwind CSS

## Context from Planning Phase
`;

  // Add conversation summary if available
  if (memory.longTermSummary) {
    prompt += `\n### Previous Discussion Summary\n${memory.longTermSummary}\n`;
  }

  if (memory.conversationSummary) {
    prompt += `\n### Earlier Topics Discussed\n${memory.conversationSummary}\n`;
  }

  // Add extracted requirements
  if (memory.requirements) {
    prompt += `\n### Extracted Requirements\n`;
    if (memory.requirements.projectType) {
      prompt += `- **Project Type**: ${memory.requirements.projectType}\n`;
    }
    if (memory.requirements.pages?.length) {
      prompt += `- **Pages to Create**: ${memory.requirements.pages.join(', ')}\n`;
    }
    if (memory.requirements.features?.length) {
      prompt += `- **Features**: ${memory.requirements.features.join(', ')}\n`;
    }
    if (memory.requirements.styling) {
      prompt += `- **Styling**: ${memory.requirements.styling}\n`;
    }
    if (memory.requirements.additionalNotes) {
      prompt += `- **Notes**: ${memory.requirements.additionalNotes}\n`;
    }
  }

  if (memory.keyDecisions.length > 0) {
    prompt += `\n### Key Decisions Made During Planning\n`;
    memory.keyDecisions.forEach(d => {
      prompt += `- ${d}\n`;
    });
  }

  if (memory.implementedFeatures.length > 0) {
    prompt += `\n### Already Implemented\n`;
    memory.implementedFeatures.forEach(f => {
      prompt += `- ${f}\n`;
    });
    prompt += `\n**Important**: Build upon existing code, don't recreate what's already done.\n`;
  }

  if (memory.recentFiles.length > 0) {
    prompt += `\n### Recent Files (for reference)\n`;
    memory.recentFiles.slice(-10).forEach(f => {
      prompt += `- ${f}\n`;
    });
  }

  prompt += `
## Implementation Guidelines
1. If the user says "implement it" or similar without specifics, use the FULL context from the planning phase above
2. Create complete, working code files
3. Use TypeScript for type safety
4. Use Tailwind CSS for modern, responsive styling
5. Include proper imports and exports
6. Create reusable components when appropriate
7. Implement responsive design (mobile-first)
8. Include accessibility features (ARIA labels, semantic HTML)

## Tech Stack
- Next.js 14+ (App Router)
- TypeScript
- Tailwind CSS
- React Hooks for state management

## Response Format
1. Brief description of what you're implementing
2. Complete code using ### FILE: format
3. After implementing, ask if the user wants to continue with the next feature`;

  return prompt;
}

/**
 * Store conversation with mode info
 */
export async function storeMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: {
    mode?: ChatMode;
    filesCreated?: string[];
  }
): Promise<void> {
  await db.insert(messages).values({
    conversationId,
    role,
    content,
    toolResults: metadata ? JSON.stringify(metadata) : null,
  });
}

/**
 * Get conversation history with mode context
 */
export async function getConversationHistory(
  conversationId: string,
  limit: number = 50
): Promise<ConversationMessage[]> {
  const dbMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt)
    .limit(limit);

  return dbMessages.map(msg => {
    const metadata = msg.toolResults as { mode?: ChatMode; filesCreated?: string[] } | null;
    return {
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
      mode: metadata?.mode,
      timestamp: msg.createdAt,
      metadata: {
        filesCreated: metadata?.filesCreated,
      },
    };
  });
}

/**
 * Create or get conversation for a project
 */
export async function getOrCreateConversation(
  projectId: string,
  existingConversationId?: string
): Promise<string> {
  if (existingConversationId) {
    const existing = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, existingConversationId))
      .limit(1);
    
    if (existing.length > 0) {
      return existing[0].id;
    }
  }

  // Create new conversation
  const [newConversation] = await db
    .insert(conversations)
    .values({ projectId })
    .returning();

  return newConversation.id;
}
