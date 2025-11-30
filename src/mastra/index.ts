import { Mastra } from '@mastra/core';
import { codeGeneratorAgent } from './agents/code-generator';
import { debugAgent } from './agents/debug';
import { analyzerAgent } from './agents/analyzer';
import { improveAgent } from './agents/improve';
import { architectAgent } from './agents/architect';
import { testGeneratorAgent } from './agents/test-generator';
import { securityAgent } from './agents/security';
import { docsAgent } from './agents/docs';
import { deployAgent } from './agents/deploy';
import { codeReviewAgent } from './agents/code-review';

export const mastra = new Mastra({
  agents: {
    // Core Development Agents
    codeGeneratorAgent,
    debugAgent,
    analyzerAgent,
    improveAgent,
    
    // SDLC Extended Agents
    architectAgent,
    testGeneratorAgent,
    securityAgent,
    docsAgent,
    deployAgent,
    codeReviewAgent,
  },
});

// Export all agents for direct use
export { 
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
};
