import Anthropic from '@anthropic-ai/sdk';
import { AI_TOOLS } from './tools';
import { SYSTEM_PROMPT } from './system-prompt';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 8192;

export interface Message {
  role: 'user' | 'assistant';
  content: string | Array<{
    type: 'text' | 'tool_use' | 'tool_result';
    text?: string;
    id?: string;
    name?: string;
    input?: any;
    tool_use_id?: string;
    content?: any;
  }>;
}

export interface StreamChunk {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done';
  content?: string;
  tool?: {
    id: string;
    name: string;
    input: any;
  };
  result?: any;
  error?: string;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (i === maxRetries - 1) throw error;
      
      // Don't retry on client errors (4xx)
      if (error.status >= 400 && error.status < 500 && error.status !== 429) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

export async function createChatCompletion(
  messages: Message[],
  onStream?: (chunk: StreamChunk) => void
): Promise<{ messages: Message[]; usage: { input_tokens: number; output_tokens: number } }> {
  
  const formattedMessages = messages.map(msg => ({
    role: msg.role,
    content: typeof msg.content === 'string' 
      ? msg.content 
      : msg.content,
  })) as Anthropic.MessageParam[];

  let allMessages = [...messages];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Tool use loop
  while (true) {
    const response = await retryWithBackoff(() =>
      anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: formattedMessages,
        tools: AI_TOOLS,
        stream: false,
      })
    );

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // Build assistant message
    const assistantMessage: Message = {
      role: 'assistant',
      content: response.content,
    };

    allMessages.push(assistantMessage);
    formattedMessages.push({
      role: 'assistant',
      content: response.content,
    });

    // Stream text content
    for (const block of response.content) {
      if (block.type === 'text' && onStream) {
        onStream({
          type: 'text',
          content: block.text,
        });
      }
    }

    // Check if we need to execute tools
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (toolUseBlocks.length === 0) {
      // No tools to execute, we're done
      break;
    }

    // Execute tools and collect results
    const toolResults: Array<{
      type: 'tool_result';
      tool_use_id: string;
      content: string;
    }> = [];

    for (const toolUse of toolUseBlocks) {
      if (onStream) {
        onStream({
          type: 'tool_use',
          tool: {
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input,
          },
        });
      }

      // Execute tool (this will be done in the API route)
      // For now, we'll add a placeholder
      const result = { success: true, message: 'Tool executed' };
      
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });

      if (onStream) {
        onStream({
          type: 'tool_result',
          result,
        });
      }
    }

    // Add tool results as user message
    formattedMessages.push({
      role: 'user',
      content: toolResults,
    });

    allMessages.push({
      role: 'user',
      content: toolResults,
    });

    // Continue loop to get AI's response to tool results
  }

  return {
    messages: allMessages,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    },
  };
}

export function countTokens(text: string): number {
  // Rough approximation: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}
