import { Mastra } from '@mastra/core';
import { codeGeneratorAgent } from './agents/code-generator';
import { debugAgent } from './agents/debug';
import { analyzerAgent } from './agents/analyzer';
import { improveAgent } from './agents/improve';

export const mastra = new Mastra({
  agents: {
    codeGeneratorAgent,
    debugAgent,
    analyzerAgent,
    improveAgent,
  },
});

export { codeGeneratorAgent, debugAgent, analyzerAgent, improveAgent };
