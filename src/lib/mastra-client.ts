/**
 * Mastra Agents Client
 * 
 * This module provides a client for interacting with Mastra AI agents.
 * It supports four different agent types:
 * - Code Generator: Creates new React/Next.js components
 * - Debug Agent: Fixes and debugs problematic code
 * - Analyzer Agent: Analyzes code structure and quality
 * - Improve Agent: Enhances existing code
 */

export type AgentType = 'generate' | 'debug' | 'analyze' | 'improve';

export interface GenerateCodeRequest {
  prompt: string;
}

export interface DebugCodeRequest {
  code: string;
  error?: string;
  context?: string;
}

export interface AnalyzeCodeRequest {
  code: string;
  focusAreas?: string[];
}

export interface ImproveCodeRequest {
  code: string;
  improvements?: string[];
}

export interface MastraResponse {
  success: boolean;
  result: string;
  agent: AgentType;
  error?: string;
  details?: string;
}

/**
 * Call a Mastra agent with the specified parameters
 */
async function callAgent(
  type: AgentType,
  data: GenerateCodeRequest | DebugCodeRequest | AnalyzeCodeRequest | ImproveCodeRequest
): Promise<MastraResponse> {
  const response = await fetch('/api/mastra', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type,
      ...data,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to call agent');
  }

  return response.json();
}

/**
 * Generate a new React/Next.js component from a prompt
 * 
 * @example
 * ```typescript
 * const result = await generateComponent({
 *   prompt: "Create a user profile card with avatar, name, and bio"
 * });
 * console.log(result.result); // Generated component code
 * ```
 */
export async function generateComponent(
  request: GenerateCodeRequest
): Promise<MastraResponse> {
  return callAgent('generate', request);
}

/**
 * Debug problematic code and get a fixed version
 * 
 * @example
 * ```typescript
 * const result = await debugCode({
 *   code: "const [count setCount] = useState(0);",
 *   error: "Syntax error: unexpected identifier"
 * });
 * console.log(result.result); // Fixed code with explanation
 * ```
 */
export async function debugCode(
  request: DebugCodeRequest
): Promise<MastraResponse> {
  return callAgent('debug', request);
}

/**
 * Analyze code for structure, patterns, and quality
 * 
 * @example
 * ```typescript
 * const result = await analyzeCode({
 *   code: myComponentCode,
 *   focusAreas: ['performance', 'accessibility']
 * });
 * console.log(result.result); // Detailed analysis
 * ```
 */
export async function analyzeCode(
  request: AnalyzeCodeRequest
): Promise<MastraResponse> {
  return callAgent('analyze', request);
}

/**
 * Improve existing code with optimizations and best practices
 * 
 * @example
 * ```typescript
 * const result = await improveCode({
 *   code: myComponentCode,
 *   improvements: ['performance', 'typescript', 'accessibility']
 * });
 * console.log(result.result); // Improved code
 * ```
 */
export async function improveCode(
  request: ImproveCodeRequest
): Promise<MastraResponse> {
  return callAgent('improve', request);
}

/**
 * Stream-based code generation (for future implementation)
 */
export async function* streamGenerate(
  request: GenerateCodeRequest
): AsyncGenerator<string, void, unknown> {
  // TODO: Implement streaming support
  const response = await generateComponent(request);
  yield response.result;
}
