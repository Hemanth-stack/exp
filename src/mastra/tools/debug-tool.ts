import { createTool } from '@mastra/core';
import { z } from 'zod';

export const debugTool = createTool({
  id: 'debug-tool',
  description: 'Analyze broken or problematic code, identify issues, and provide working solutions with explanations',
  inputSchema: z.object({
    code: z.string().describe('The code that needs debugging'),
    error: z.string().optional().describe('Optional error message or description of the problem'),
    context: z.string().optional().describe('Additional context about where/how the code is used'),
  }),
  outputSchema: z.object({
    issues: z.array(z.object({
      line: z.number().optional(),
      description: z.string(),
      severity: z.enum(['error', 'warning', 'info']),
    })),
    fixedCode: z.string(),
    explanation: z.string(),
    recommendations: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => {
    const { code, error, context: codeContext } = context;

    // The actual debugging happens through the LLM
    return {
      issues: [],
      fixedCode: code,
      explanation: 'Analysis will be provided by the LLM',
      recommendations: [],
    };
  },
});
