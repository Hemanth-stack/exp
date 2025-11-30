import { NextRequest, NextResponse } from 'next/server';
import { 
  codeGeneratorAgent, 
  debugAgent, 
  analyzerAgent, 
  improveAgent,
  architectAgent,
  testGeneratorAgent,
  securityAgent,
  docsAgent,
  deployAgent,
  codeReviewAgent,
} from '@/mastra';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface MastraRequest {
  prompt: string;
  type?: 'generate' | 'debug' | 'analyze' | 'improve' | 'architect' | 'test' | 'security' | 'docs' | 'deploy' | 'review';
  code?: string;
  error?: string;
  context?: string;
  improvements?: string[];
  focusAreas?: string[];
  projectContext?: {
    framework?: string;
    dependencies?: string[];
    existingFiles?: string[];
  };
}

// Helper to build rich context for agents
function buildContextualPrompt(
  type: string,
  basePrompt: string,
  options: {
    code?: string;
    error?: string;
    context?: string;
    improvements?: string[];
    focusAreas?: string[];
    projectContext?: MastraRequest['projectContext'];
  }
): string {
  const parts: string[] = [];

  // Add project context if available
  if (options.projectContext) {
    parts.push('## PROJECT CONTEXT');
    if (options.projectContext.framework) {
      parts.push(`Framework: ${options.projectContext.framework}`);
    }
    if (options.projectContext.dependencies?.length) {
      parts.push(`Available Dependencies: ${options.projectContext.dependencies.join(', ')}`);
    }
    if (options.projectContext.existingFiles?.length) {
      parts.push(`Existing Files: ${options.projectContext.existingFiles.join(', ')}`);
    }
    parts.push('');
  }

  // Type-specific formatting
  switch (type) {
    case 'generate':
      parts.push('## REQUEST');
      parts.push(basePrompt);
      if (options.context) {
        parts.push('');
        parts.push('## ADDITIONAL CONTEXT');
        parts.push(options.context);
      }
      break;

    case 'debug':
      parts.push('## CODE WITH ISSUE');
      parts.push('```tsx');
      parts.push(options.code || '');
      parts.push('```');
      parts.push('');
      if (options.error) {
        parts.push('## ERROR MESSAGE');
        parts.push('```');
        parts.push(options.error);
        parts.push('```');
        parts.push('');
      }
      if (options.context) {
        parts.push('## ADDITIONAL CONTEXT');
        parts.push(options.context);
        parts.push('');
      }
      parts.push('## USER DESCRIPTION');
      parts.push(basePrompt || 'Please debug this code and fix all issues.');
      break;

    case 'analyze':
      parts.push('## CODE TO ANALYZE');
      parts.push('```tsx');
      parts.push(options.code || '');
      parts.push('```');
      parts.push('');
      if (options.focusAreas?.length) {
        parts.push('## FOCUS AREAS');
        options.focusAreas.forEach((area, i) => {
          parts.push(`${i + 1}. ${area}`);
        });
        parts.push('');
      }
      if (basePrompt) {
        parts.push('## SPECIFIC QUESTIONS');
        parts.push(basePrompt);
      }
      break;

    case 'improve':
      parts.push('## CODE TO IMPROVE');
      parts.push('```tsx');
      parts.push(options.code || '');
      parts.push('```');
      parts.push('');
      if (options.improvements?.length) {
        parts.push('## IMPROVEMENT PRIORITIES');
        options.improvements.forEach((imp, i) => {
          parts.push(`${i + 1}. ${imp}`);
        });
        parts.push('');
      }
      if (basePrompt) {
        parts.push('## SPECIFIC REQUESTS');
        parts.push(basePrompt);
      }
      break;

    case 'architect':
      parts.push('## PROJECT REQUIREMENTS');
      parts.push(basePrompt);
      if (options.context) {
        parts.push('');
        parts.push('## ADDITIONAL CONTEXT');
        parts.push(options.context);
      }
      break;

    case 'test':
      parts.push('## CODE TO TEST');
      parts.push('```tsx');
      parts.push(options.code || '');
      parts.push('```');
      parts.push('');
      parts.push('## TESTING REQUIREMENTS');
      parts.push(basePrompt || 'Generate comprehensive tests for this code.');
      break;

    case 'security':
      parts.push('## CODE TO AUDIT');
      parts.push('```tsx');
      parts.push(options.code || '');
      parts.push('```');
      parts.push('');
      parts.push('## SECURITY FOCUS');
      parts.push(basePrompt || 'Perform a comprehensive security audit.');
      break;

    case 'docs':
      if (options.code) {
        parts.push('## CODE TO DOCUMENT');
        parts.push('```tsx');
        parts.push(options.code);
        parts.push('```');
        parts.push('');
      }
      parts.push('## DOCUMENTATION REQUEST');
      parts.push(basePrompt);
      if (options.context) {
        parts.push('');
        parts.push('## ADDITIONAL CONTEXT');
        parts.push(options.context);
      }
      break;

    case 'deploy':
      parts.push('## DEPLOYMENT REQUEST');
      parts.push(basePrompt);
      if (options.context) {
        parts.push('');
        parts.push('## CURRENT SETUP');
        parts.push(options.context);
      }
      break;

    case 'review':
      parts.push('## CODE FOR REVIEW');
      parts.push('```tsx');
      parts.push(options.code || '');
      parts.push('```');
      parts.push('');
      if (options.context) {
        parts.push('## PR DESCRIPTION / CONTEXT');
        parts.push(options.context);
        parts.push('');
      }
      parts.push('## REVIEW FOCUS');
      parts.push(basePrompt || 'Please review this code thoroughly.');
      break;
  }

  return parts.join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const body: MastraRequest = await request.json();
    const { 
      prompt, 
      type = 'generate', 
      code, 
      error, 
      context, 
      improvements, 
      focusAreas,
      projectContext 
    } = body;

    if (!prompt && !code) {
      return NextResponse.json(
        { error: 'Prompt or code is required' },
        { status: 400 }
      );
    }

    let agent;
    let userMessage = '';

    // Select agent and build contextual prompt
    switch (type) {
      case 'generate':
        agent = codeGeneratorAgent;
        userMessage = buildContextualPrompt('generate', prompt, { context, projectContext });
        break;

      case 'debug':
        agent = debugAgent;
        userMessage = buildContextualPrompt('debug', prompt, { 
          code, 
          error, 
          context, 
          projectContext 
        });
        break;

      case 'analyze':
        agent = analyzerAgent;
        userMessage = buildContextualPrompt('analyze', prompt, { 
          code, 
          focusAreas, 
          projectContext 
        });
        break;

      case 'improve':
        agent = improveAgent;
        userMessage = buildContextualPrompt('improve', prompt, { 
          code, 
          improvements, 
          projectContext 
        });
        break;

      case 'architect':
        agent = architectAgent;
        userMessage = buildContextualPrompt('architect', prompt, { 
          context, 
          projectContext 
        });
        break;

      case 'test':
        agent = testGeneratorAgent;
        userMessage = buildContextualPrompt('test', prompt, { 
          code, 
          projectContext 
        });
        break;

      case 'security':
        agent = securityAgent;
        userMessage = buildContextualPrompt('security', prompt, { 
          code, 
          projectContext 
        });
        break;

      case 'docs':
        agent = docsAgent;
        userMessage = buildContextualPrompt('docs', prompt, { 
          code, 
          context, 
          projectContext 
        });
        break;

      case 'deploy':
        agent = deployAgent;
        userMessage = buildContextualPrompt('deploy', prompt, { 
          context, 
          projectContext 
        });
        break;

      case 'review':
        agent = codeReviewAgent;
        userMessage = buildContextualPrompt('review', prompt, { 
          code, 
          context, 
          projectContext 
        });
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid agent type' },
          { status: 400 }
        );
    }

    // Execute the agent
    const response = await agent.generate([
      {
        role: 'user',
        content: userMessage,
      },
    ]);

    // Extract the text content from the response
    const textContent = response.text || '';

    return NextResponse.json({
      success: true,
      result: textContent,
      agent: type,
    });

  } catch (error: unknown) {
    console.error('Mastra API Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { 
        error: 'Failed to process request',
        details: errorMessage 
      },
      { status: 500 }
    );
  }
}
