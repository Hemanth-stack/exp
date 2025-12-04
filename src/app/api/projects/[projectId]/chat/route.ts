import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { conversations, messages, projects, users } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import fs from 'fs/promises';
import path from 'path';
import { gitManager, normalizeRepoPath } from '@/lib/git-manager';
import { 
  getProjectContext, 
  getFileContext,
  formatContextForPrompt,
  formatFileContextForModification 
} from '@/lib/code-context';
import { checkRateLimit, createRateLimitHeaders, getRateLimitIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
// Agent tools available for explicit user requests like "check for errors" or "run type check"
// import { agentTools, AgentToolContext } from '@/lib/agent-tools';
import {
  buildMemoryLane,
  buildSystemPrompt,
  type ChatMode,
  type ConversationMessage,
} from '@/lib/chat-memory';

// Detect intent from message
function detectIntent(message: string): {
  type: 'generate' | 'debug' | 'analyze' | 'improve' | 'modify' | 'architect' | 'test' | 'security' | 'docs' | 'deploy' | 'review' | 'general';
  targetFile?: string;
  confidence: number;
} {
  const lower = message.toLowerCase();
  
  // Check for file modification intent
  const fileMatch = message.match(/(?:modify|change|update|edit)\s+(?:the\s+)?(?:file\s+)?([^\s]+\.tsx?)/i) 
    || message.match(/### FILE:\s*([^\n]+)/i)
    || message.match(/(?:in|for)\s+([^\s]+\.tsx?)/i);
  
  // Architecture/Planning keywords
  if (
    lower.includes('architect') ||
    lower.includes('plan') ||
    lower.includes('design system') ||
    lower.includes('structure') ||
    lower.includes('how should i build') ||
    lower.includes('what components')
  ) {
    return { type: 'architect', confidence: 0.9 };
  }

  // Testing keywords
  if (
    lower.includes('test') ||
    lower.includes('testing') ||
    lower.includes('write tests') ||
    lower.includes('unit test') ||
    lower.includes('integration test') ||
    lower.includes('spec')
  ) {
    return { 
      type: 'test', 
      targetFile: fileMatch?.[1],
      confidence: 0.9 
    };
  }

  // Security keywords
  if (
    lower.includes('security') ||
    lower.includes('vulnerability') ||
    lower.includes('secure') ||
    lower.includes('audit') ||
    lower.includes('xss') ||
    lower.includes('injection') ||
    lower.includes('authentication')
  ) {
    return { 
      type: 'security', 
      targetFile: fileMatch?.[1],
      confidence: 0.9 
    };
  }

  // Documentation keywords
  if (
    lower.includes('document') ||
    lower.includes('readme') ||
    lower.includes('jsdoc') ||
    lower.includes('comment') ||
    lower.includes('explain the code') ||
    lower.includes('api docs')
  ) {
    return { 
      type: 'docs', 
      targetFile: fileMatch?.[1],
      confidence: 0.85 
    };
  }

  // Deployment keywords
  if (
    lower.includes('deploy') ||
    lower.includes('deployment') ||
    lower.includes('docker') ||
    lower.includes('ci/cd') ||
    lower.includes('vercel') ||
    lower.includes('production') ||
    lower.includes('github actions')
  ) {
    return { type: 'deploy', confidence: 0.9 };
  }

  // Code Review keywords
  if (
    lower.includes('review my code') ||
    lower.includes('code review') ||
    lower.includes('pr review') ||
    lower.includes('feedback on') ||
    lower.includes('critique')
  ) {
    return { 
      type: 'review', 
      targetFile: fileMatch?.[1],
      confidence: 0.9 
    };
  }

  // Modification keywords (updating existing code)
  if (
    (lower.includes('modify') ||
    lower.includes('change') ||
    lower.includes('update') ||
    lower.includes('edit') ||
    lower.includes('add to') ||
    lower.includes('remove from')) &&
    !lower.includes('create')
  ) {
    return { 
      type: 'modify', 
      targetFile: fileMatch?.[1],
      confidence: 0.9 
    };
  }
  
  // Generation keywords (new code)
  if (
    lower.includes('create') ||
    lower.includes('generate') ||
    lower.includes('make a') ||
    lower.includes('build') ||
    lower.includes('design')
  ) {
    return { type: 'generate', confidence: 0.9 };
  }
  
  // Debug keywords
  if (
    lower.includes('error') ||
    lower.includes('bug') ||
    lower.includes('fix') ||
    lower.includes('broken') ||
    lower.includes('not working')
  ) {
    return { 
      type: 'debug', 
      targetFile: fileMatch?.[1],
      confidence: 0.85 
    };
  }
  
  // Analysis keywords
  if (
    lower.includes('analyze') ||
    lower.includes('check') ||
    lower.includes('inspect')
  ) {
    return { type: 'analyze', confidence: 0.8 };
  }
  
  // Improvement keywords
  if (
    lower.includes('improve') ||
    lower.includes('optimize') ||
    lower.includes('enhance') ||
    lower.includes('better') ||
    lower.includes('refactor')
  ) {
    return { 
      type: 'improve', 
      targetFile: fileMatch?.[1],
      confidence: 0.8 
    };
  }
  
  return { type: 'generate', confidence: 0.5 }; // Default to generation
}

// Parse component from AI response
function parseComponent(response: string): {
  name: string;
  code: string;
  description: string;
  filePath: string;
} | null {
  console.log('🔍 Parsing component from response...');
  
  try {
    // Try JSON parsing first (for structured agent output)
    const jsonMatch = response.match(/\{[\s\S]*"(?:componentName|name|code)"[\s\S]*\}/);
    if (jsonMatch) {
      const json = JSON.parse(jsonMatch[0]);
      const name = json.componentName || json.name || 'Component';
      console.log('✅ Parsed JSON format, component:', name);
      return {
        name,
        code: json.code || '',
        description: json.description || `Generated ${name}`,
        filePath: `app/components/${name}.tsx`,
      };
    }
  } catch {
    console.log('⚠️  JSON parsing failed, trying markdown extraction');
  }
  
  // Extract from markdown code blocks
  const codeMatch = response.match(/```(?:typescript|tsx|jsx|ts|js|javascript|react)?\s*\n([\s\S]+?)\n```/);
  if (!codeMatch) {
    console.log('❌ No code block found in response');
    return null;
  }
  
  const code = codeMatch[1].trim();
  console.log('📝 Extracted code block, length:', code.length);
  
  // Extract component name from code
  const nameMatch = code.match(/(?:export\s+)?(?:default\s+)?(?:function|const)\s+(\w+)/);
  const name = nameMatch ? nameMatch[1] : 'Component';
  console.log('🏷️  Component name:', name);
  
  // Extract description from text before code block
  const beforeCode = response.substring(0, response.indexOf('```'));
  const descMatch = beforeCode.match(/(?:I'll create|Creating|Here's|This is)\s+(?:a\s+)?(.+?)(?:\.|:|\n)/i);
  const description = descMatch ? descMatch[1].trim() : `Generated ${name} component`;
  
  console.log('✅ Component parsed successfully:', { name, description, codeLength: code.length });
  
  return {
    name,
    code,
    description,
    filePath: `app/components/${name}.tsx`,
  };
}

// Parse multiple files from AI response (new multi-file format)
function parseMultipleFiles(response: string): Array<{
  filePath: string;
  code: string;
  name: string;
}> {
  const files: Array<{ filePath: string; code: string; name: string }> = [];
  
  // Match the ### FILE: pattern for multi-file responses
  const filePattern = /###\s*FILE:\s*([^\n]+)\n```(?:typescript|tsx|jsx|ts|js|javascript|react|css|json)?\s*\n([\s\S]*?)```/gi;
  
  let match;
  while ((match = filePattern.exec(response)) !== null) {
    const filePath = match[1].trim();
    const code = match[2].trim();
    const name = filePath.split('/').pop() || filePath;
    
    files.push({ filePath, code, name });
    console.log(`📁 Parsed file: ${filePath}`);
  }
  
  // If no multi-file format found, try single file extraction
  if (files.length === 0) {
    const singleComponent = parseComponent(response);
    if (singleComponent) {
      files.push({
        filePath: singleComponent.filePath,
        code: singleComponent.code,
        name: singleComponent.name,
      });
    }
  }
  
  console.log(`✅ Total files parsed: ${files.length}`);
  return files;
}

// Get system prompt based on intent
function getSystemPrompt(intentType: string, hasContext: boolean = false): string {
  const contextNote = hasContext 
    ? `\n\n## CONTEXT PROVIDED
You have been given the current project files. Use this context to:
1. Understand the existing code structure and patterns
2. Maintain consistency with existing styling and conventions  
3. Properly import from and integrate with existing components
4. Avoid duplicating existing functionality` 
    : '';

  const basePrompt = `# IDENTITY & PURPOSE
You are a world-class senior full-stack engineer specializing in React 18+, Next.js 14+ App Router, and TypeScript 5+. You write production-ready, maintainable code that follows industry best practices.

## CORE RULES
1. ✅ ALWAYS provide COMPLETE, working code that can be directly saved
2. ✅ Use TypeScript with explicit types (no \`any\` unless absolutely necessary)
3. ✅ Use Tailwind CSS for all styling
4. ✅ Use 'use client' directive ONLY when using hooks or browser APIs
5. ✅ Include ALL necessary imports
6. ❌ NEVER leave TODO comments or placeholder code
7. ❌ NEVER omit error handling or loading states

## MULTI-FILE FORMAT
When creating or editing files, use this EXACT format:

### FILE: app/components/ComponentName.tsx
\`\`\`tsx
// complete code here
\`\`\`

### FILE: app/page.tsx  
\`\`\`tsx
// complete code here
\`\`\`

## RESPONSE FORMAT
1. Brief description (1-2 sentences max)
2. Complete code for each file using ### FILE: format
3. No additional explanation after code${contextNote}`;

  switch (intentType) {
    case 'modify':
      return `# IDENTITY & PURPOSE  
You are a world-class code modification specialist. Your job is to surgically update existing code while preserving all functionality that shouldn't change.

## CRITICAL MODIFICATION RULES
1. ✅ READ the existing code carefully before making changes
2. ✅ PRESERVE all existing functionality unless explicitly asked to remove it
3. ✅ MAINTAIN the existing code style and patterns
4. ✅ UPDATE imports if you add new dependencies
5. ✅ Provide the COMPLETE modified file (not just changed parts)
6. ❌ NEVER remove existing features accidentally
7. ❌ NEVER break existing imports or exports

## MODIFICATION APPROACH
<thinking>
1. What specific change is being requested?
2. What existing code must be preserved?
3. What new code needs to be added/changed?
4. Are there any imports that need updating?
5. Will this change affect other files?
</thinking>

## OUTPUT FORMAT
### FILE: [exact path of modified file]
\`\`\`tsx
// complete modified file - NOT just the changed parts
\`\`\`

If the modification requires changes to multiple files, include all of them.${contextNote}`;

    case 'debug':
      return `# IDENTITY & PURPOSE
You are an expert debugger who finds root causes, not just symptoms. You fix code completely and explain why the issue occurred.

## DEBUGGING PROCESS
1. Identify the EXACT error or unexpected behavior
2. Find the ROOT CAUSE (not just the symptom)
3. Provide a COMPLETE fix that addresses the root cause
4. Explain how to prevent this in the future

## COMMON ISSUES TO CHECK
- Missing 'use client' directive
- Incorrect imports or missing dependencies
- TypeScript type mismatches
- React hooks rules violations
- Async/await issues
- Hydration mismatches

## OUTPUT FORMAT
### 🐛 Issue Identified
[What's wrong - 1 line]

### 🔍 Root Cause  
[Why this happens - 1-2 lines]

### FILE: [path to fixed file]
\`\`\`tsx
// complete fixed code
\`\`\`

### 🛡️ Prevention
[How to avoid this - 1 line]${contextNote}`;

    case 'improve':
      return `# IDENTITY & PURPOSE
You are an elite code optimizer who improves code while maintaining 100% backward compatibility.

## IMPROVEMENT AREAS
1. **Performance**: memo, useMemo, useCallback where beneficial
2. **Type Safety**: Eliminate any, add proper interfaces
3. **Accessibility**: ARIA, keyboard navigation, semantic HTML
4. **Error Handling**: Loading states, error boundaries
5. **Code Quality**: DRY, single responsibility, clear naming

## RULES
1. ✅ PRESERVE all existing functionality exactly
2. ✅ Provide COMPLETE improved file (not snippets)
3. ❌ NEVER remove features or change behavior unless asked

## OUTPUT FORMAT
### 📈 Improvements Made
[Brief list of what was improved]

### FILE: [path]
\`\`\`tsx
// complete improved code
\`\`\`${contextNote}`;

    case 'analyze':
      return `You are an expert code analyzer for React, Next.js, and TypeScript.
Provide concise, actionable analysis. Be brief and direct.
      
Rate each area 1-10:
- Type Safety
- Performance  
- Accessibility
- Code Quality
- Error Handling

Provide specific recommendations with code examples.${contextNote}`;

    default:
      return basePrompt;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limiting for AI endpoint (stricter limits)
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimitResult = checkRateLimit(identifier, RATE_LIMITS.ai);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before sending more messages.' },
        { 
          status: 429,
          headers: createRateLimitHeaders(rateLimitResult)
        }
      );
    }

    const { projectId } = await params;

    // Validate projectId format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    const { message: userMessage, conversationId, mode = 'agent' } = await request.json();
    const chatMode: ChatMode = mode === 'chat' ? 'chat' : 'agent';

    if (!userMessage || (typeof userMessage === 'string' && userMessage.trim().length === 0)) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    // Validate message length (prevent abuse)
    if (typeof userMessage !== 'string' || userMessage.length > 50000) {
      return NextResponse.json({ error: 'Message too long (max 50,000 characters)' }, { status: 400 });
    }

    // Trim the message
    const trimmedMessage = userMessage.trim();

    // Get project info
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get user's GitHub access token for pushing
    const [user] = await db
      .select({ githubAccessToken: users.githubAccessToken })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    const githubAccessToken = user?.githubAccessToken || undefined;

    // Get or create conversation
    let conversation;
    if (conversationId) {
      [conversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);
    } else {
      [conversation] = await db
        .insert(conversations)
        .values({ projectId })
        .returning();
    }

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Load conversation history (more for chat mode to build memory)
    const historyLimit = chatMode === 'chat' ? 20 : 6;
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(desc(messages.createdAt))
      .limit(historyLimit);

    // Build memory lane from conversation history for context
    const conversationHistory: ConversationMessage[] = history.reverse().map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
      timestamp: msg.createdAt,
      metadata: msg.toolResults as { filesCreated?: string[] } | undefined,
    }));
    const memoryLane = buildMemoryLane(conversationHistory);

    // Save user message with mode info (non-blocking)
    db.insert(messages).values({
      conversationId: conversation.id,
      role: 'user',
      content: trimmedMessage,
      toolResults: JSON.stringify({ mode: chatMode }),
    }).then(() => {}).catch(console.error);

    // Create abort controller to handle client disconnection
    const abortController = new AbortController();
    let isAborted = false;

    // Create streaming response
    const encoder = new TextEncoder();
    let fullResponse = '';
    const createdFiles: string[] = [];

    // Helper function to check if aborted before sending
    const safeEnqueue = (controller: ReadableStreamDefaultController, data: string) => {
      if (!isAborted) {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Stream was closed
          isAborted = true;
        }
      }
    };

    // Helper function to send step updates
    const sendStep = (controller: ReadableStreamDefaultController, step: {
      type: 'step';
      step: string;
      status: 'start' | 'complete' | 'error';
      message: string;
      details?: string;
      icon?: string;
    }) => {
      safeEnqueue(controller, `data: ${JSON.stringify(step)}\n\n`);
    };

    // Helper to send thinking/planning output
    const sendThinking = (controller: ReadableStreamDefaultController, thought: string) => {
      safeEnqueue(controller, `data: ${JSON.stringify({
        type: 'thinking',
        content: thought,
      })}\n\n`);
    };

    // =============================================================================
    // CHAT MODE: Simple conversational flow - NO code generation, NO file changes
    // Includes read-only project context so AI can explain existing code
    // =============================================================================
    if (chatMode === 'chat') {
      const stream = new ReadableStream({
        async start(controller) {
          try {
            sendStep(controller, {
              type: 'step',
              step: 'understanding',
              status: 'start',
              message: 'Reading your message...',
              icon: '💬'
            });

            // Get project context for read-only understanding (no modification)
            let projectContextForChat = '';
            try {
              const repoPath = normalizeRepoPath(projectId);
              const projectContext = await getProjectContext(repoPath);
              if (projectContext) {
                projectContextForChat = `\n\n## Project Context (Read-Only Reference)\nYou can discuss and explain this code, but CANNOT modify it in Chat Mode.\n\n${formatContextForPrompt(projectContext)}`;
              }
            } catch {
              // Ignore errors - project context is optional for chat
            }
            
            await new Promise(resolve => setTimeout(resolve, 200));
            
            sendStep(controller, {
              type: 'step',
              step: 'understanding',
              status: 'complete',
              message: 'Ready to discuss',
              icon: '💬'
            });

            // Build the chat-only system prompt with optional project context
            let chatSystemPrompt = buildSystemPrompt('chat', memoryLane);
            if (projectContextForChat) {
              chatSystemPrompt += projectContextForChat;
            }
            
            // Build conversation for the AI
            const chatMessages: Array<{ role: 'user' | 'assistant'; content: string }> = history
              .reverse()
              .filter(msg => msg.content && msg.content.trim().length > 0)
              .map(msg => ({
                role: msg.role as 'user' | 'assistant',
                content: msg.content.trim(),
              }));
            
            chatMessages.push({ role: 'user', content: trimmedMessage });

            sendStep(controller, {
              type: 'step',
              step: 'thinking',
              status: 'start',
              message: 'Thinking about your question...',
              icon: '💭'
            });

            // Use streamText for chat mode - simple conversation
            const result = streamText({
              model: anthropic('claude-sonnet-4-20250514'),
              system: chatSystemPrompt,
              messages: chatMessages,
              temperature: 0.7, // More conversational
              abortSignal: abortController.signal,
            });

            // Stream the response
            for await (const chunk of (await result).textStream) {
              if (isAborted) break;
              fullResponse += chunk;
              safeEnqueue(controller, `data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`);
            }

            sendStep(controller, {
              type: 'step',
              step: 'thinking',
              status: 'complete',
              message: 'Response ready',
              icon: '💬'
            });

            sendStep(controller, {
              type: 'step',
              step: 'complete',
              status: 'complete',
              message: '💬 Discussion complete (read-only mode)',
              details: 'Switch to Agent Mode (🤖) to implement code',
              icon: '✅'
            });

            // Save assistant message
            db.insert(messages).values({
              conversationId: conversation.id,
              role: 'assistant',
              content: fullResponse,
              toolResults: JSON.stringify({ mode: 'chat', filesCreated: [] }),
            }).then(() => {}).catch(console.error);

            // Send done signal
            safeEnqueue(controller, `data: ${JSON.stringify({
              type: 'done',
              conversationId: conversation.id,
              filesCreated: 0,
              mode: 'chat',
            })}\n\n`);

            controller.close();
          } catch (error) {
            console.error('Chat mode error:', error);
            if (!isAborted) {
              safeEnqueue(controller, `data: ${JSON.stringify({ 
                type: 'error', 
                error: 'Failed to process chat message' 
              })}\n\n`);
              controller.close();
            }
          }
        },
        cancel() {
          isAborted = true;
          abortController.abort();
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // =============================================================================
    // AGENT MODE: Full implementation flow with code generation and file writing
    // =============================================================================
    
    // Detect intent and target file (only for Agent Mode)
    const intent = detectIntent(trimmedMessage);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Step 1: Understanding the request
          sendStep(controller, {
            type: 'step',
            step: 'understanding',
            status: 'start',
            message: 'Analyzing your request...',
            icon: '🧠'
          });
          
          await new Promise(resolve => setTimeout(resolve, 400)); // Small delay for UX
                    // Determine the agent type description and icon
          const agentInfo: Record<string, { desc: string; icon: string }> = {
            'generate': { desc: 'Creating new components', icon: '✨' },
            'modify': { desc: 'Modifying existing code', icon: '📝' },
            'debug': { desc: 'Finding and fixing bugs', icon: '🐛' },
            'improve': { desc: 'Optimizing code quality', icon: '⚡' },
            'analyze': { desc: 'Analyzing code patterns', icon: '🔍' },
            'architect': { desc: 'Planning system design', icon: '🏗️' },
            'test': { desc: 'Generating test cases', icon: '🧪' },
            'security': { desc: 'Security vulnerability scan', icon: '🔒' },
            'docs': { desc: 'Generating documentation', icon: '📚' },
            'deploy': { desc: 'Setting up deployment', icon: '🚀' },
            'review': { desc: 'Reviewing code quality', icon: '👀' },
          };
          
          const agentData = agentInfo[intent.type] || { desc: 'Processing request', icon: '⚙️' };
          
          sendStep(controller, {
            type: 'step',
            step: 'understanding',
            status: 'complete',
            message: `Request understood: ${agentData.desc}`,
            details: intent.targetFile ? `Target: ${intent.targetFile}` : undefined,
            icon: agentData.icon
          });

          // Step 2: Gathering context (if applicable)
          let contextPrompt = '';
          let hasContext = false;
          let contextFiles: string[] = [];
          
          // Normalize the repo path for Docker environment
          const repoPath = project.gitRepoPath ? normalizeRepoPath(project.gitRepoPath) : null;
          
          if (repoPath) {
            sendStep(controller, {
              type: 'step',
              step: 'context',
              status: 'start',
              message: 'Scanning project files...',
              icon: '📂'
            });

            try {
              if (intent.type === 'modify' || intent.type === 'debug' || intent.type === 'improve' || 
                  intent.type === 'test' || intent.type === 'security' || intent.type === 'review') {
                // For modifications, get specific file context with related files
                if (intent.targetFile) {
                  sendStep(controller, {
                    type: 'step',
                    step: 'reading_file',
                    status: 'start',
                    message: `Reading ${intent.targetFile}...`,
                    icon: '📄'
                  });
                  
                  const fileContext = await getFileContext(repoPath, intent.targetFile);
                  
                  if (fileContext.targetFile) {
                    contextPrompt = formatFileContextForModification(
                      fileContext.targetFile,
                      fileContext.relatedFiles,
                      fileContext.projectStructure
                    );
                    hasContext = true;
                    contextFiles = [fileContext.targetFile.path, ...fileContext.relatedFiles.map(f => f.path)];
                    
                    sendStep(controller, {
                      type: 'step',
                      step: 'reading_file',
                      status: 'complete',
                      message: `Loaded ${intent.targetFile}`,
                      details: fileContext.relatedFiles.length > 0 
                        ? `+ ${fileContext.relatedFiles.length} related files` 
                        : undefined,
                      icon: '📄'
                    });
                  }
                } else {
                  // No specific file, get broader project context
                  sendStep(controller, {
                    type: 'step',
                    step: 'analyzing',
                    status: 'start',
                    message: 'Analyzing project structure...',
                    icon: '🔍'
                  });
                  
                  const projectContext = await getProjectContext(repoPath, {
                    maxContext: 40000,
                  });
                  contextPrompt = formatContextForPrompt(projectContext);
                  hasContext = true;
                  contextFiles = projectContext.files.map(f => f.path);
                  
                  sendStep(controller, {
                    type: 'step',
                    step: 'analyzing',
                    status: 'complete',
                    message: `Analyzed ${contextFiles.length} files`,
                    icon: '🔍'
                  });
                }
              } else if (intent.type === 'generate' || intent.type === 'architect') {
                // For generation, provide project structure and existing patterns
                sendStep(controller, {
                  type: 'step',
                  step: 'analyzing',
                  status: 'start',
                  message: 'Loading existing patterns...',
                  icon: '🔍'
                });
                
                const projectContext = await getProjectContext(repoPath, {
                  maxContext: 30000,
                });
                contextPrompt = formatContextForPrompt(projectContext);
                hasContext = true;
                contextFiles = projectContext.files.map(f => f.path);
                
                sendStep(controller, {
                  type: 'step',
                  step: 'analyzing',
                  status: 'complete',
                  message: 'Project patterns loaded',
                  details: `${contextFiles.length} files analyzed`,
                  icon: '🔍'
                });
              }
              
              if (hasContext) {
                sendStep(controller, {
                  type: 'step',
                  step: 'context',
                  status: 'complete',
                  message: `Context ready (${contextFiles.length} files)`,
                  details: contextFiles.slice(0, 3).join(', ') + (contextFiles.length > 3 ? ` +${contextFiles.length - 3} more` : ''),
                  icon: '✅'
                });
              } else {
                sendStep(controller, {
                  type: 'step',
                  step: 'context',
                  status: 'complete',
                  message: 'Starting fresh (no existing files)',
                  icon: '📭'
                });
              }
            } catch (error) {
              console.error('Error gathering context:', error);
              sendStep(controller, {
                type: 'step',
                step: 'context',
                status: 'error',
                message: 'Could not load project context',
                icon: '⚠️'
              });
            }
          }

          // Step 3: Planning / Thinking
          // Use Agent Mode system prompt with intent and memory context
          const systemPrompt = getSystemPrompt(intent.type, hasContext);
          
          // Send planning information based on intent
          const planningInfo: Record<string, string> = {
            'generate': `Planning to create new ${intent.targetFile ? intent.targetFile : 'components'}...`,
            'modify': `Planning to modify ${intent.targetFile || 'existing code'}...`,
            'debug': `Analyzing potential bugs and fixes...`,
            'improve': `Identifying optimization opportunities...`,
            'analyze': `Preparing code analysis...`,
            'architect': `Designing system architecture...`,
            'test': `Planning test coverage...`,
            'security': `Scanning for vulnerabilities...`,
            'docs': `Planning documentation structure...`,
            'deploy': `Preparing deployment configuration...`,
            'review': `Setting up code review criteria...`,
          };
          
          sendStep(controller, {
            type: 'step',
            step: 'planning',
            status: 'start',
            message: planningInfo[intent.type] || 'Planning approach...',
            details: `Mode: ${chatMode} | Intent: ${intent.type}`,
            icon: '📋'
          });
          
          // Send initial thinking output
          sendThinking(controller, `🎯 **Goal**: ${trimmedMessage.slice(0, 100)}${trimmedMessage.length > 100 ? '...' : ''}`);
          
          if (intent.targetFile) {
            sendThinking(controller, `📁 **Target**: ${intent.targetFile}`);
          }
          
          if (contextFiles.length > 0) {
            sendThinking(controller, `📚 **Context**: ${contextFiles.length} files loaded`);
          }
          
          await new Promise(resolve => setTimeout(resolve, 200));
          
          sendStep(controller, {
            type: 'step',
            step: 'planning',
            status: 'complete',
            message: 'Plan ready',
            icon: '✅'
          });
          
          sendStep(controller, {
            type: 'step',
            step: 'thinking',
            status: 'start',
            message: 'AI is reasoning...',
            details: 'Formulating the best approach',
            icon: '🤔'
          });

          // Build conversation messages for AI - filter out empty messages
          const conversationMessages: Array<{ role: 'user' | 'assistant'; content: string }> = history
            .reverse()
            .filter(msg => msg.content && msg.content.trim().length > 0) // Filter empty messages
            .map(msg => ({
              role: msg.role as 'user' | 'assistant',
              content: msg.content.trim(),
            }));
          
          // Add current message with context - ensure it's never empty
          const enhancedMessage = contextPrompt 
            ? `${contextPrompt}\n\n---\n\n## 💬 USER REQUEST\n${trimmedMessage}`
            : trimmedMessage;
          
          // Only add if we have content
          if (enhancedMessage.length > 0) {
            conversationMessages.push({ role: 'user', content: enhancedMessage });
          } else {
            // Fallback to a default message if somehow empty
            conversationMessages.push({ role: 'user', content: 'Please help me with my project.' });
          }

          // Short delay to show thinking step
          await new Promise(resolve => setTimeout(resolve, 300));

          // Check if aborted before AI call
          if (isAborted) {
            controller.close();
            return;
          }

          // Step 4: Streaming response
          sendStep(controller, {
            type: 'step',
            step: 'generating',
            status: 'start',
            message: 'Generating code...',
            details: 'Writing optimized, production-ready code',
            icon: '✨'
          });

          // Stream from Claude using Vercel AI SDK with abort signal
          const result = streamText({
            model: anthropic('claude-sonnet-4-20250514'),
            system: systemPrompt,
            messages: conversationMessages,
            abortSignal: abortController.signal,
          });

          // Stream text chunks as they arrive
          let isFirstChunk = true;
          for await (const chunk of (await result).textStream) {
            // Check if client disconnected
            if (isAborted) {
              console.log('🛑 Client disconnected, stopping generation');
              break;
            }

            if (isFirstChunk) {
              sendStep(controller, {
                type: 'step',
                step: 'thinking',
                status: 'complete',
                message: 'Analysis complete',
                icon: '🧠'
              });
              isFirstChunk = false;
            }
            
            fullResponse += chunk;
            safeEnqueue(controller, `data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`);
          }

          // If aborted during generation, close stream
          if (isAborted) {
            try {
              controller.close();
            } catch {}
            return;
          }

          sendStep(controller, {
            type: 'step',
            step: 'generating',
            status: 'complete',
            message: 'Code generation complete',
            details: `Generated ${fullResponse.length} characters`,
            icon: '✨'
          });

          // Step 5: Process and write files - Agent Mode only
          // (Chat Mode returns early above and never reaches here)
          if (['generate', 'modify', 'improve', 'debug', 'test', 'docs'].includes(intent.type) && repoPath) {
            sendStep(controller, {
              type: 'step',
              step: 'parsing',
              status: 'start',
              message: 'Extracting code blocks...',
              icon: '🔍'
            });

            const parsedFiles = parseMultipleFiles(fullResponse);
            
            if (parsedFiles.length > 0) {
              sendStep(controller, {
                type: 'step',
                step: 'parsing',
                status: 'complete',
                message: `Found ${parsedFiles.length} file(s) to write`,
                details: parsedFiles.map(f => f.name).join(', '),
                icon: '📦'
              });

              sendStep(controller, {
                type: 'step',
                step: 'writing',
                status: 'start',
                message: 'Saving files to project...',
                icon: '💾'
              });

              const projectPath = repoPath;
              let successCount = 0;
              
              for (const file of parsedFiles) {
                try {
                  const fullPath = path.join(projectPath, file.filePath);
                  const dir = path.dirname(fullPath);
                  
                  // Check if file exists (update vs create)
                  let isUpdate = false;
                  let existingContent = '';
                  try {
                    existingContent = await fs.readFile(fullPath, 'utf-8');
                    isUpdate = true;
                  } catch {}
                  
                  await fs.mkdir(dir, { recursive: true });
                  await fs.writeFile(fullPath, file.code, 'utf-8');
                  
                  createdFiles.push(file.filePath);
                  successCount++;
                  
                  // Send detailed file action info with before/after content for undo
                  const actionDetails = isUpdate 
                    ? `Modified existing file (${existingContent.length} → ${file.code.length} chars)`
                    : `New file created (${file.code.length} chars)`;
                  
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({
                      type: 'file_created',
                      file: { path: file.filePath, name: file.name },
                      action: isUpdate ? 'updated' : 'created',
                      details: actionDetails,
                      beforeContent: isUpdate ? existingContent : null,
                      afterContent: file.code,
                    })}\n\n`)
                  );

                  sendStep(controller, {
                    type: 'step',
                    step: 'file_write',
                    status: 'complete',
                    message: isUpdate ? `📝 Updated: ${file.filePath}` : `✅ Created: ${file.filePath}`,
                    details: actionDetails,
                    icon: isUpdate ? '📝' : '📄'
                  });

                } catch (err) {
                  console.error(`Error writing ${file.filePath}:`, err);
                  sendStep(controller, {
                    type: 'step',
                    step: 'file_write',
                    status: 'error',
                    message: `❌ Failed: ${file.filePath}`,
                    details: err instanceof Error ? err.message : 'Unknown error',
                    icon: '❌'
                  });
                }
              }

              // Auto-update main page for single component
              const hasMainPage = parsedFiles.some(f => 
                f.filePath === 'app/page.tsx' || f.filePath === 'page.tsx'
              );
              const componentFiles = parsedFiles.filter(f => 
                f.filePath.includes('/components/') && f.filePath.endsWith('.tsx')
              );
              
              if (!hasMainPage && componentFiles.length === 1) {
                const componentName = componentFiles[0].name.replace('.tsx', '');
                try {
                  const mainPagePath = path.join(projectPath, 'app', 'page.tsx');
                  await fs.writeFile(mainPagePath, `'use client';\n\nimport ${componentName} from './components/${componentName}';\n\nexport default function Home() {\n  return <${componentName} />;\n}\n`, 'utf-8');
                  createdFiles.push('app/page.tsx');
                  successCount++;
                  
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({
                      type: 'file_created',
                      file: { path: 'app/page.tsx', name: 'page.tsx' },
                      action: 'updated',
                    })}\n\n`)
                  );

                  sendStep(controller, {
                    type: 'step',
                    step: 'file_write',
                    status: 'complete',
                    message: 'Auto-linked component to page.tsx',
                    icon: '🔗'
                  });
                } catch {}
              }

              sendStep(controller, {
                type: 'step',
                step: 'writing',
                status: 'complete',
                message: `Saved ${successCount} file(s) successfully`,
                icon: '💾'
              });

              // Auto-commit the changes
              try {
                sendStep(controller, {
                  type: 'step',
                  step: 'committing',
                  status: 'start',
                  message: 'Committing changes to git...',
                  icon: '📝'
                });

                const commitMessage = `AI: ${createdFiles.length === 1 
                  ? `Updated ${createdFiles[0]}` 
                  : `Updated ${createdFiles.length} files`}`;
                await gitManager.commit(projectPath, commitMessage, session.user.email || undefined, session.user.name || undefined);

                sendStep(controller, {
                  type: 'step',
                  step: 'committing',
                  status: 'complete',
                  message: 'Changes committed successfully',
                  icon: '✅'
                });

                // Push to GitHub in background (non-blocking) if user has access token
                if (githubAccessToken) {
                  sendStep(controller, {
                    type: 'step',
                    step: 'pushing',
                    status: 'complete',
                    message: 'Pushing to GitHub (background)...',
                    icon: '☁️'
                  });

                  // Fire and forget - push happens async
                  gitManager.pushAsync(projectPath, githubAccessToken);
                }
              } catch (commitErr) {
                console.error('Auto-commit error:', commitErr);
                sendStep(controller, {
                  type: 'step',
                  step: 'committing',
                  status: 'error',
                  message: 'Failed to commit changes (files still saved)',
                  details: commitErr instanceof Error ? commitErr.message : 'Unknown error',
                  icon: '⚠️'
                });
              }

              // NOTE: Auto-validation disabled - it was blocking preview and slowing down responses.
              // The terminal agent should be invoked explicitly by the user when they encounter errors,
              // not automatically on every code generation. This keeps the response flow fast.
              // To manually trigger validation, users can ask: "check for errors" or "run type check"

            } else {
              sendStep(controller, {
                type: 'step',
                step: 'parsing',
                status: 'complete',
                message: 'No code files to save (text response)',
                icon: '💬'
              });
            }
          }
          // Note: Chat Mode returns early above and never reaches here

          // Final step: Complete (Agent Mode only)
          sendStep(controller, {
            type: 'step',
            step: 'complete',
            status: 'complete',
            message: createdFiles.length > 0 
              ? `Done! Created/updated ${createdFiles.length} file(s)` 
              : 'Response complete',
            icon: '🎉'
          });

          // Save assistant message with mode info (non-blocking)
          db.insert(messages).values({
            conversationId: conversation.id,
            role: 'assistant',
            content: fullResponse,
            toolCalls: createdFiles.length > 0 ? [{ files: createdFiles }] : null,
            toolResults: JSON.stringify({ 
              mode: 'agent', 
              filesCreated: createdFiles 
            }),
          }).then(() => {}).catch(console.error);

          // Send completion
          safeEnqueue(controller, `data: ${JSON.stringify({
            type: 'done',
            conversationId: conversation.id,
            filesCreated: createdFiles.length,
            mode: 'agent',
            requirements: memoryLane.requirements,
          })}\n\n`);

          controller.close();
        } catch (error: unknown) {
          // Don't log abort errors as they're expected
          if (error instanceof Error && error.name !== 'AbortError') {
            console.error('Stream error:', error);
          }
          if (!isAborted) {
            safeEnqueue(controller, `data: ${JSON.stringify({
              type: 'error',
              error: error instanceof Error ? error.message : 'Unknown error',
            })}\n\n`);
          }
          try {
            controller.close();
          } catch {}
        }
      },
      cancel() {
        // Called when client disconnects/aborts
        console.log('🛑 Client disconnected, aborting AI generation');
        isAborted = true;
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: unknown) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// Get conversation messages
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');

    if (!conversationId) {
      const convos = await db
        .select()
        .from(conversations)
        .where(eq(conversations.projectId, projectId))
        .orderBy(desc(conversations.createdAt));

      return NextResponse.json({ conversations: convos });
    }

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);

    return NextResponse.json({ messages: msgs });
  } catch (error: unknown) {
    console.error('Get messages error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
