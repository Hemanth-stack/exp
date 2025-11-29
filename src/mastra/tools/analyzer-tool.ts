import { createTool } from '@mastra/core';
import { z } from 'zod';

export const analyzerTool = createTool({
  id: 'analyzer-tool',
  description: 'Provide detailed analysis of code structure, patterns, potential issues, and suggestions for improvement',
  inputSchema: z.object({
    code: z.string().describe('The code to analyze'),
    focusAreas: z.array(z.string()).optional().describe('Specific areas to focus on (e.g., performance, security, accessibility)'),
  }),
  outputSchema: z.object({
    summary: z.string(),
    structure: z.object({
      components: z.number().optional(),
      hooks: z.number().optional(),
      functions: z.number().optional(),
    }).optional(),
    patterns: z.array(z.string()),
    issues: z.array(z.object({
      type: z.string(),
      description: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
    })),
    suggestions: z.array(z.string()),
    metrics: z.object({
      complexity: z.string().optional(),
      maintainability: z.string().optional(),
    }).optional(),
  }),
  execute: async ({ context }) => {
    const { code, focusAreas } = context;

    // The actual analysis happens through the LLM
    return {
      summary: 'Analysis will be provided by the LLM',
      patterns: [],
      issues: [],
      suggestions: [],
    };
  },
});
