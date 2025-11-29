import { NextRequest, NextResponse } from 'next/server';
import { 
  codeGeneratorAgent, 
  debugAgent, 
  analyzerAgent, 
  improveAgent 
} from '@/mastra';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface MastraRequest {
  prompt: string;
  type?: 'generate' | 'debug' | 'analyze' | 'improve';
  code?: string;
  error?: string;
  context?: string;
  improvements?: string[];
  focusAreas?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: MastraRequest = await request.json();
    const { prompt, type = 'generate', code, error, context, improvements, focusAreas } = body;

    if (!prompt && !code) {
      return NextResponse.json(
        { error: 'Prompt or code is required' },
        { status: 400 }
      );
    }

    let agent;
    let userMessage = '';

    // Select agent based on type
    switch (type) {
      case 'generate':
        agent = codeGeneratorAgent;
        userMessage = prompt;
        break;

      case 'debug':
        agent = debugAgent;
        userMessage = `Debug this code: ${code}\n${error ? `Error: ${error}` : ''}\n${context ? `Context: ${context}` : ''}`;
        break;

      case 'analyze':
        agent = analyzerAgent;
        userMessage = `Analyze this code: ${code}\n${focusAreas ? `Focus on: ${focusAreas.join(', ')}` : ''}`;
        break;

      case 'improve':
        agent = improveAgent;
        userMessage = `Improve this code: ${code}\n${improvements ? `Focus on: ${improvements.join(', ')}` : ''}`;
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

  } catch (error: any) {
    console.error('Mastra API Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process request',
        details: error.message 
      },
      { status: 500 }
    );
  }
}
