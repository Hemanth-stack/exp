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
  requirements: ProjectRequirements | null;
  conversationSummary: string | null;
  keyDecisions: string[];
  implementedFeatures: string[];
}

/**
 * Build a memory lane from conversation history
 * This gives the AI context about what has been discussed and implemented
 */
export function buildMemoryLane(history: ConversationMessage[]): MemoryLane {
  const shortTermMemory = history.slice(-10); // Last 10 messages
  
  // Extract requirements from conversation
  const requirements = extractRequirements(history);
  
  // Generate summary of earlier conversation
  const conversationSummary = generateSummary(history.slice(0, -10));
  
  // Extract key decisions
  const keyDecisions = extractKeyDecisions(history);
  
  // Track what's been implemented
  const implementedFeatures = extractImplementedFeatures(history);
  
  return {
    shortTermMemory,
    requirements,
    conversationSummary,
    keyDecisions,
    implementedFeatures,
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
  let prompt = `You are a friendly and helpful AI assistant helping the user plan and design their web project.

## Your Role in Chat Mode
- Ask clarifying questions to understand what the user wants to build
- Help them think through requirements, features, and design choices
- Provide suggestions and recommendations based on best practices
- Do NOT generate code yet - this is the planning phase
- When requirements are clear and user confirms, suggest switching to "Agent Mode" to start implementation

## Guidelines
1. Be conversational and friendly
2. Ask one question at a time to avoid overwhelming the user
3. Summarize requirements periodically to ensure alignment
4. Suggest modern, best-practice approaches
5. Consider user experience and accessibility

## Key Questions to Cover (if not already discussed)
- What type of project is this? (blog, portfolio, e-commerce, etc.)
- What pages/sections do they need?
- Any specific features? (contact form, newsletter, comments, etc.)
- Design preferences? (modern, minimalist, colorful, dark mode)
- Any specific tech requirements or preferences?
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
Keep responses concise and conversational. When you think requirements are clear enough to start building, say something like:
"Great! I think I have a clear picture of what you want. Ready to start building? Switch to **Agent Mode** and I'll begin implementing your ${memory.requirements?.projectType || 'project'}!"`;

  return prompt;
}

function buildAgentModePrompt(memory: MemoryLane): string {
  let prompt = `You are an expert full-stack developer implementing a web project based on the user's requirements.

## Your Role in Agent Mode
- Generate high-quality, production-ready code
- Implement features systematically, one at a time
- Follow the requirements gathered in the planning phase
- Create well-structured, maintainable code with proper components
- Use modern React patterns and Tailwind CSS for styling

## Project Requirements from Planning Phase
`;

  if (memory.requirements) {
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

  if (memory.implementedFeatures.length > 0) {
    prompt += `\n## Already Implemented\n`;
    memory.implementedFeatures.forEach(f => {
      prompt += `- ${f}\n`;
    });
    prompt += `\nBuild upon existing code, don't recreate what's already done.\n`;
  }

  if (memory.keyDecisions.length > 0) {
    prompt += `\n## Key Decisions from Planning\n`;
    memory.keyDecisions.forEach(d => {
      prompt += `- ${d}\n`;
    });
  }

  prompt += `
## Implementation Guidelines
1. Create one file at a time with complete, working code
2. Use TypeScript for type safety
3. Use Tailwind CSS for styling with modern, responsive designs
4. Include proper imports and exports
5. Add helpful comments for complex logic
6. Create reusable components when appropriate
7. Implement responsive design (mobile-first)
8. Include accessibility features (ARIA labels, semantic HTML)

## Tech Stack
- Next.js 14+ (App Router)
- TypeScript
- Tailwind CSS
- React Hooks for state management

## Response Format
When implementing, explain briefly what you're creating, then provide the code. After each file, ask if the user wants to continue to the next feature.`;

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
