/**
 * Integration Example: Using Mastra Agents with Existing Chat System
 * 
 * This file shows how to integrate Mastra agents into your existing
 * chat interface and project builder.
 */

'use client';

import { useState } from 'react';
import { generateComponent, debugCode, analyzeCode, improveCode } from '@/lib/mastra-client';

// ============================================================================
// Example 1: Integration with Chat Interface
// ============================================================================

/**
 * Enhanced chat handler that uses Mastra agents based on user intent
 */
export async function handleChatMessage(
  message: string,
  projectId: string,
  conversationHistory: Array<{ role: string; content: string }>
) {
  // Detect user intent from message
  const intent = detectIntent(message);
  
  try {
    switch (intent.type) {
      case 'generate':
        // User wants to create something new
        const generated = await generateComponent({
          prompt: message
        });
        
        // Parse and add to project
        const component = parseGeneratedComponent(generated.result);
        await addComponentToProject(projectId, component);
        
        return {
          response: generated.result,
          action: 'component_created',
          componentName: component.name
        };
        
      case 'debug':
        // User has an error or problem
        const debugged = await debugCode({
          code: intent.codeContext || '',
          error: intent.error,
          context: message
        });
        
        return {
          response: debugged.result,
          action: 'code_fixed',
        };
        
      case 'analyze':
        // User wants insights
        const analysis = await analyzeCode({
          code: intent.codeContext || '',
          focusAreas: intent.focusAreas
        });
        
        return {
          response: analysis.result,
          action: 'analysis_complete',
        };
        
      case 'improve':
        // User wants optimization
        const improved = await improveCode({
          code: intent.codeContext || '',
          improvements: intent.improvements
        });
        
        return {
          response: improved.result,
          action: 'code_improved',
        };
        
      default:
        // Fallback to your existing AI system
        return await handleWithExistingAI(message, conversationHistory);
    }
  } catch (error) {
    console.error('Mastra agent error:', error);
    // Fallback to existing system
    return await handleWithExistingAI(message, conversationHistory);
  }
}

// ============================================================================
// Example 2: Intent Detection
// ============================================================================

interface Intent {
  type: 'generate' | 'debug' | 'analyze' | 'improve' | 'general';
  codeContext?: string;
  error?: string;
  focusAreas?: string[];
  improvements?: string[];
}

function detectIntent(message: string): Intent {
  const lower = message.toLowerCase();
  
  // Check for generation keywords
  if (
    lower.includes('create') ||
    lower.includes('generate') ||
    lower.includes('make a') ||
    lower.includes('build a')
  ) {
    return { type: 'generate' };
  }
  
  // Check for debugging keywords
  if (
    lower.includes('error') ||
    lower.includes('bug') ||
    lower.includes('fix') ||
    lower.includes('broken') ||
    lower.includes('not working')
  ) {
    return { 
      type: 'debug',
      error: message 
    };
  }
  
  // Check for analysis keywords
  if (
    lower.includes('analyze') ||
    lower.includes('review') ||
    lower.includes('check') ||
    lower.includes('what does this')
  ) {
    return { 
      type: 'analyze',
      focusAreas: extractFocusAreas(message)
    };
  }
  
  // Check for improvement keywords
  if (
    lower.includes('improve') ||
    lower.includes('optimize') ||
    lower.includes('enhance') ||
    lower.includes('better')
  ) {
    return { 
      type: 'improve',
      improvements: extractImprovements(message)
    };
  }
  
  return { type: 'general' };
}

function extractFocusAreas(message: string): string[] {
  const areas: string[] = [];
  const keywords = {
    performance: ['performance', 'speed', 'fast', 'optimize'],
    accessibility: ['accessibility', 'a11y', 'aria'],
    security: ['security', 'safe', 'secure'],
    typescript: ['typescript', 'types', 'typing'],
  };
  
  const lower = message.toLowerCase();
  for (const [area, words] of Object.entries(keywords)) {
    if (words.some(word => lower.includes(word))) {
      areas.push(area);
    }
  }
  
  return areas;
}

function extractImprovements(message: string): string[] {
  return extractFocusAreas(message); // Same logic
}

// ============================================================================
// Example 3: Component Parser
// ============================================================================

interface ParsedComponent {
  name: string;
  code: string;
  description: string;
  dependencies: string[];
}

function parseGeneratedComponent(result: string): ParsedComponent {
  // Try to parse as JSON first
  try {
    const json = JSON.parse(result);
    return {
      name: json.componentName || 'GeneratedComponent',
      code: json.code || result,
      description: json.description || '',
      dependencies: json.dependencies || [],
    };
  } catch {
    // If not JSON, extract from markdown code blocks
    const codeMatch = result.match(/```(?:typescript|tsx|jsx)?\n([\s\S]+?)\n```/);
    const code = codeMatch ? codeMatch[1] : result;
    
    // Try to extract component name from code
    const nameMatch = code.match(/(?:export\s+)?(?:default\s+)?(?:function|const)\s+(\w+)/);
    const name = nameMatch ? nameMatch[1] : 'GeneratedComponent';
    
    return {
      name,
      code,
      description: 'Generated component',
      dependencies: [],
    };
  }
}

// ============================================================================
// Example 4: Project Integration
// ============================================================================

async function addComponentToProject(projectId: string, component: ParsedComponent) {
  // This would integrate with your existing project management system
  const response = await fetch(`/api/projects/${projectId}/components`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: component.name,
      code: component.code,
      description: component.description,
    }),
  });
  
  if (!response.ok) {
    throw new Error('Failed to add component to project');
  }
  
  return response.json();
}

// ============================================================================
// Example 5: Batch Operations
// ============================================================================

/**
 * Generate multiple components in parallel
 */
export async function batchGenerate(prompts: string[]) {
  const results = await Promise.all(
    prompts.map(prompt => generateComponent({ prompt }))
  );
  
  return results.map((result, index) => ({
    prompt: prompts[index],
    component: parseGeneratedComponent(result.result),
  }));
}

/**
 * Analyze and improve code in sequence
 */
export async function analyzeAndImprove(code: string) {
  // First analyze
  const analysis = await analyzeCode({ code });
  
  // Extract issues from analysis
  const improvements = extractImprovementsFromAnalysis(analysis.result);
  
  // Then improve based on analysis
  const improved = await improveCode({ 
    code, 
    improvements 
  });
  
  return {
    analysis: analysis.result,
    improved: improved.result,
  };
}

function extractImprovementsFromAnalysis(analysis: string): string[] {
  // Parse the analysis to extract improvement suggestions
  const improvements: string[] = [];
  
  if (analysis.includes('performance')) improvements.push('performance');
  if (analysis.includes('accessibility')) improvements.push('accessibility');
  if (analysis.includes('TypeScript')) improvements.push('typescript');
  if (analysis.includes('security')) improvements.push('security');
  
  return improvements;
}

// ============================================================================
// Example 6: Streaming Response (Future Implementation)
// ============================================================================

/**
 * Stream agent responses for better UX
 */
export async function* streamAgentResponse(
  agentType: 'generate' | 'debug' | 'analyze' | 'improve',
  params: any
) {
  // This is a placeholder for future streaming implementation
  // For now, we'll return the complete response
  
  let result;
  switch (agentType) {
    case 'generate':
      result = await generateComponent(params);
      break;
    case 'debug':
      result = await debugCode(params);
      break;
    case 'analyze':
      result = await analyzeCode(params);
      break;
    case 'improve':
      result = await improveCode(params);
      break;
  }
  
  // Simulate streaming by yielding chunks
  const chunks = result.result.split('\n');
  for (const chunk of chunks) {
    yield chunk + '\n';
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

// ============================================================================
// Example 7: React Hook for Easy Integration
// ============================================================================

/**
 * Custom React hook for using Mastra agents
 */
export function useMastraAgent() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  
  const execute = async (
    type: 'generate' | 'debug' | 'analyze' | 'improve',
    params: any
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      let response;
      
      switch (type) {
        case 'generate':
          response = await generateComponent(params);
          break;
        case 'debug':
          response = await debugCode(params);
          break;
        case 'analyze':
          response = await analyzeCode(params);
          break;
        case 'improve':
          response = await improveCode(params);
          break;
      }
      
      setResult(response.result);
      return response;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };
  
  return { loading, error, result, execute };
}

// ============================================================================
// Example 8: Usage in React Component
// ============================================================================

/**
 * Example React component using the hook
 */
export function ComponentGenerator() {
  const { loading, error, result, execute } = useMastraAgent();
  const [prompt, setPrompt] = useState('');
  
  const handleGenerate = async () => {
    await execute('generate', { prompt });
  };
  
  return (
    <div>
      <textarea 
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe your component..."
      />
      <button onClick={handleGenerate} disabled={loading}>
        {loading ? 'Generating...' : 'Generate'}
      </button>
      {error && <div className="error">{error}</div>}
      {result && <pre>{result}</pre>}
    </div>
  );
}

// ============================================================================
// Fallback to Existing AI System
// ============================================================================

async function handleWithExistingAI(
  message: string,
  history: Array<{ role: string; content: string }>
) {
  // This would call your existing Anthropic chat implementation
  // from src/lib/ai/client.ts
  return {
    response: 'Fallback response from existing system',
    action: 'general_chat',
  };
}

// ============================================================================
// Usage Example in Your Chat Component
// ============================================================================

/**
 * Example integration in your existing chat component:
 * 
 * ```typescript
 * import { handleChatMessage } from '@/lib/mastra-integration';
 * 
 * const ChatInterface = () => {
 *   const handleSubmit = async (message: string) => {
 *     const result = await handleChatMessage(
 *       message,
 *       projectId,
 *       conversationHistory
 *     );
 *     
 *     // Update UI with result
 *     addMessage({ role: 'assistant', content: result.response });
 *     
 *     // Handle any actions (component created, code fixed, etc.)
 *     if (result.action === 'component_created') {
 *       refreshProjectComponents();
 *     }
 *   };
 *   
 *   // ... rest of component
 * };
 * ```
 */
