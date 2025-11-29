import { createTool } from '@mastra/core';
import { z } from 'zod';

export const improveTool = createTool({
  id: 'improve-tool',
  description: 'Take existing code and make it better in terms of performance, readability, accessibility, and best practices',
  inputSchema: z.object({
    code: z.string().describe('The code to improve'),
    improvements: z.array(z.string()).optional().describe('Specific improvements to focus on (e.g., performance, accessibility, TypeScript)'),
    constraints: z.string().optional().describe('Any constraints or requirements to maintain'),
  }),
  outputSchema: z.object({
    improvedCode: z.string(),
    changes: z.array(z.object({
      category: z.string(),
      description: z.string(),
      impact: z.enum(['low', 'medium', 'high']),
    })),
    summary: z.string(),
    bestPractices: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => {
    const { code, improvements, constraints } = context;

    // The actual improvement happens through the LLM
    return {
      improvedCode: code,
      changes: [],
      summary: 'Improvements will be provided by the LLM',
      bestPractices: [],
    };
  },
});
