import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { conversations, messages, projects } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import fs from 'fs/promises';
import path from 'path';

// Detect intent from message
function detectIntent(message: string): {
  type: 'generate' | 'debug' | 'analyze' | 'improve' | 'general';
  confidence: number;
} {
  const lower = message.toLowerCase();
  
  // Generation keywords
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
    return { type: 'debug', confidence: 0.85 };
  }
  
  // Analysis keywords
  if (
    lower.includes('analyze') ||
    lower.includes('review') ||
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
    lower.includes('better')
  ) {
    return { type: 'improve', confidence: 0.8 };
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
function getSystemPrompt(intentType: string): string {
  const basePrompt = `You are an expert React and Next.js code generator. Your role is to generate complete, functional React components and help edit existing code.

## RULES:
1. ALWAYS provide complete, working code that can be directly saved to a file
2. Use TypeScript with proper typing
3. Use Tailwind CSS for all styling (the project has Tailwind configured)
4. For Next.js App Router, use 'use client' directive when component uses hooks or browser APIs
5. Make components self-contained - include all necessary imports

## MULTI-FILE SUPPORT:
When creating or editing multiple files, use this format for EACH file:

### FILE: app/components/ComponentName.tsx
\`\`\`tsx
// code here
\`\`\`

### FILE: app/page.tsx  
\`\`\`tsx
// code here
\`\`\`

## RESPONSE FORMAT:
1. Start with a VERY brief description (1 sentence max)
2. Immediately provide the complete code for each file using the ### FILE: format
3. Keep explanations minimal - focus on code`;

  switch (intentType) {
    case 'debug':
      return `You are an expert code debugger for React, Next.js, and TypeScript.

## YOUR ROLE:
1. Analyze code issues carefully
2. Identify root causes, not just symptoms  
3. Provide working fixes with clear explanations
4. Fix single or multiple files as needed

## MULTI-FILE FIX FORMAT:
When fixing multiple files, use this format:

### FILE: app/components/BrokenComponent.tsx
\`\`\`tsx
// fixed code here
\`\`\`

## RESPONSE FORMAT:
1. Brief issue description (1 line)
2. Fixed code using ### FILE: format
3. Keep it concise`;

    case 'improve':
      return `You are an expert code improvement specialist for React, Next.js, and TypeScript.

## YOUR ROLE:
Take existing code and make it better while maintaining original functionality.

## IMPROVEMENT AREAS:
1. Performance: memoization, optimize re-renders
2. Code Quality: better types, cleaner logic
3. Accessibility: ARIA, keyboard nav
4. Best Practices: modern React patterns

## MULTI-FILE FORMAT:
### FILE: app/components/ComponentName.tsx
\`\`\`tsx
// improved code here
\`\`\`

## RESPONSE FORMAT:
1. Brief summary of improvements (1 line)
2. Complete improved code using ### FILE: format`;

    case 'analyze':
      return `You are an expert code analyzer for React, Next.js, and TypeScript.
Provide concise, actionable analysis. Be brief and direct.`;

    default:
      return basePrompt;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const { message: userMessage, conversationId } = await request.json();

    if (!userMessage) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    // Get project info
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

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

    // Load conversation history (limit to last 6 for speed)
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(desc(messages.createdAt))
      .limit(6);

    // Save user message (non-blocking)
    db.insert(messages).values({
      conversationId: conversation.id,
      role: 'user',
      content: userMessage,
    }).then(() => {}).catch(console.error);

    // Detect intent
    const intent = detectIntent(userMessage);
    const systemPrompt = getSystemPrompt(intent.type);

    // Build conversation messages for AI
    const conversationMessages: Array<{ role: 'user' | 'assistant'; content: string }> = history
      .reverse()
      .map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));
    
    // Add current message
    conversationMessages.push({ role: 'user', content: userMessage });

    // Create streaming response
    const encoder = new TextEncoder();
    let fullResponse = '';
    const createdFiles: string[] = [];

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial status
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Thinking...' })}\n\n`)
          );

          // Stream from Claude using Vercel AI SDK
          const result = streamText({
            model: anthropic('claude-sonnet-4-20250514'),
            system: systemPrompt,
            messages: conversationMessages,
          });

          // Stream text chunks as they arrive
          for await (const chunk of (await result).textStream) {
            fullResponse += chunk;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`)
            );
          }

          // Process files after streaming is complete
          if (['generate', 'improve', 'debug'].includes(intent.type) && project.gitRepoPath) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Creating files...' })}\n\n`)
            );

            const parsedFiles = parseMultipleFiles(fullResponse);
            
            if (parsedFiles.length > 0) {
              const projectPath = project.gitRepoPath;
              
              for (const file of parsedFiles) {
                try {
                  const fullPath = path.join(projectPath, file.filePath);
                  const dir = path.dirname(fullPath);
                  await fs.mkdir(dir, { recursive: true });
                  await fs.writeFile(fullPath, file.code, 'utf-8');
                  
                  createdFiles.push(file.filePath);
                  
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({
                      type: 'file_created',
                      file: { path: file.filePath, name: file.name },
                    })}\n\n`)
                  );
                } catch (err) {
                  console.error(`Error writing ${file.filePath}:`, err);
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
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({
                      type: 'file_created',
                      file: { path: 'app/page.tsx', name: 'page.tsx' },
                    })}\n\n`)
                  );
                } catch {}
              }
            }
          }

          // Save assistant message (non-blocking)
          db.insert(messages).values({
            conversationId: conversation.id,
            role: 'assistant',
            content: fullResponse,
            toolCalls: createdFiles.length > 0 ? [{ files: createdFiles }] : null,
          }).then(() => {}).catch(console.error);

          // Send completion
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              type: 'done',
              conversationId: conversation.id,
              filesCreated: createdFiles.length,
            })}\n\n`)
          );

          controller.close();
        } catch (error: unknown) {
          console.error('Stream error:', error);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              type: 'error',
              error: error instanceof Error ? error.message : 'Unknown error',
            })}\n\n`)
          );
          controller.close();
        }
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
