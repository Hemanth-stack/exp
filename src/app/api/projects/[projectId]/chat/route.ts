import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { conversations, messages, projects } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { codeGeneratorAgent, debugAgent, analyzerAgent, improveAgent } from '@/mastra';
import fs from 'fs/promises';
import path from 'path';

const MAX_TOKENS = 8192;

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
  } catch (e) {
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

    // Load conversation history
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(desc(messages.createdAt))
      .limit(10);

    // Save user message
    await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'user',
      content: userMessage,
    });

    // Detect intent
    const intent = detectIntent(userMessage);

    // Stream response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send agent selection notification
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'agent_selected',
                agent: intent.type,
                confidence: intent.confidence,
              })}\n\n`
            )
          );

          // Select appropriate agent
          let agent;
          let agentName = '';
          
          switch (intent.type) {
            case 'generate':
              agent = codeGeneratorAgent;
              agentName = '🎨 Code Generator';
              break;
            case 'debug':
              agent = debugAgent;
              agentName = '🐛 Debug Agent';
              break;
            case 'analyze':
              agent = analyzerAgent;
              agentName = '🔍 Analyzer';
              break;
            case 'improve':
              agent = improveAgent;
              agentName = '⚡ Improver';
              break;
            default:
              agent = codeGeneratorAgent;
              agentName = '🎨 Code Generator';
          }

          // Send agent execution start
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'agent_start',
                agent: agentName,
              })}\n\n`
            )
          );

          // Build conversation history
          const conversationHistory = history
            .reverse()
            .map(msg => ({
              role: msg.role as 'user' | 'assistant',
              content: msg.content,
            }));

          // Add current message
          conversationHistory.push({
            role: 'user',
            content: userMessage,
          });

          // Execute agent
          const response = await agent.generate(conversationHistory);
          
          const assistantResponse = response.text || '';

          // Send text response
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'text',
                content: assistantResponse,
              })}\n\n`
            )
          );

          // Try to create files if it's a generation request
          let createdFiles: string[] = [];
          if (intent.type === 'generate') {
            console.log('📁 Attempting to create files for generation request...');
            const component = parseComponent(assistantResponse);
            
            if (component) {
              console.log('✅ Component parsed successfully:', component.name);
              try {
                // Create project directory structure
                const projectPath = path.join(process.cwd(), 'user-repos', projectId);
                const componentDir = path.join(projectPath, 'app', 'components');
                
                console.log('📂 Creating directory:', componentDir);
                // Ensure directory exists
                await fs.mkdir(componentDir, { recursive: true });
                
                // Write component file
                const filePath = path.join(projectPath, component.filePath);
                console.log('💾 Writing file:', filePath);
                await fs.writeFile(filePath, component.code, 'utf-8');
                console.log('✅ File written successfully!');
                
                createdFiles.push(component.filePath);

                // Send file creation notification
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'file_created',
                      file: {
                        path: component.filePath,
                        name: component.name,
                        description: component.description,
                      },
                    })}\n\n`
                  )
                );

                // Create a preview page if it doesn't exist
                const previewPath = path.join(projectPath, 'app', 'preview', 'page.tsx');
                const previewDir = path.join(projectPath, 'app', 'preview');
                await fs.mkdir(previewDir, { recursive: true });
                
                const previewCode = `'use client';

import ${component.name} from '../components/${component.name}';

export default function PreviewPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Component Preview</h1>
          <p className="text-gray-600 mt-2">${component.description}</p>
        </div>
        <div className="bg-white rounded-lg shadow-lg p-8">
          <${component.name} />
        </div>
      </div>
    </div>
  );
}
`;
                await fs.writeFile(previewPath, previewCode, 'utf-8');

                // Send preview link
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'preview_ready',
                      url: `http://localhost:3000/builder/${projectId}?preview=true`,
                      component: component.name,
                    })}\n\n`
                  )
                );
              } catch (fileError: any) {
                console.error('File creation error:', fileError);
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'warning',
                      message: 'Could not create files automatically. Please copy the code manually.',
                    })}\n\n`
                  )
                );
              }
            }
          }

          // Save assistant message
          await db.insert(messages).values({
            conversationId: conversation.id,
            role: 'assistant',
            content: assistantResponse,
            toolCalls: createdFiles.length > 0 ? [{ files: createdFiles }] : null,
          });

          // Send completion
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'done',
                conversationId: conversation.id,
                filesCreated: createdFiles.length,
              })}\n\n`
            )
          );

          controller.close();
        } catch (error: any) {
          console.error('Chat error:', error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                error: error.message,
              })}\n\n`
            )
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
  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
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
  } catch (error: any) {
    console.error('Get messages error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
