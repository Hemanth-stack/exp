/**
 * Agent Terminal Tools
 * Provides terminal execution capabilities for AI agents
 */

import { 
  executeCommand, 
  analyzeError, 
  autoResolveError,
  isCommandAllowed,
  getContainerLogs,
  CommandResult,
} from './terminal-service';
import { getSandboxInfo } from './docker-service';

export interface AgentToolContext {
  sessionId?: string;
  containerId?: string;
  projectPath?: string;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Execute a terminal command (for agents)
 */
export async function agentExecuteCommand(
  command: string,
  context: AgentToolContext
): Promise<ToolResult<CommandResult>> {
  // Validate context
  if (!context.sessionId && !context.containerId) {
    return {
      success: false,
      error: 'No sandbox session or container ID provided',
    };
  }

  // Get container ID from session if needed
  let containerId = context.containerId;
  if (!containerId && context.sessionId) {
    const sandboxInfo = await getSandboxInfo(context.sessionId);
    if (!sandboxInfo) {
      return {
        success: false,
        error: `Sandbox session ${context.sessionId} not found`,
      };
    }
    containerId = sandboxInfo.containerId;
  }

  if (!containerId) {
    return {
      success: false,
      error: 'Could not determine container ID',
    };
  }

  // Check if command is allowed
  const validation = isCommandAllowed(command);
  if (!validation.allowed) {
    return {
      success: false,
      error: `Command not allowed: ${validation.reason}`,
    };
  }

  // Execute the command
  const result = await executeCommand(containerId, command, {
    workDir: context.projectPath || '/app',
    timeout: 120000, // 2 minute timeout for agent commands
  });

  return {
    success: result.success,
    data: result,
    error: result.success ? undefined : result.stderr || 'Command failed',
  };
}

/**
 * Install an npm package (for agents)
 */
export async function agentInstallPackage(
  packageName: string,
  context: AgentToolContext,
  options: { dev?: boolean } = {}
): Promise<ToolResult<CommandResult>> {
  const flag = options.dev ? '-D' : '';
  const command = `npm install ${flag} ${packageName}`.trim();
  
  return agentExecuteCommand(command, context);
}

/**
 * Run npm script (for agents)
 */
export async function agentRunScript(
  scriptName: string,
  context: AgentToolContext
): Promise<ToolResult<CommandResult>> {
  const command = `npm run ${scriptName}`;
  return agentExecuteCommand(command, context);
}

/**
 * Check for errors and get fix suggestions (for agents)
 */
export async function agentAnalyzeErrors(
  context: AgentToolContext
): Promise<ToolResult<{
  hasErrors: boolean;
  suggestions: Array<{ command: string; description: string; confidence: number }>;
  logs: { stdout: string; stderr: string };
}>> {
  // Get container ID
  let containerId: string | undefined;
  if (context.containerId) {
    containerId = context.containerId;
  } else if (context.sessionId) {
    const sandboxInfo = await getSandboxInfo(context.sessionId);
    if (!sandboxInfo) {
      return {
        success: false,
        error: `Sandbox session ${context.sessionId} not found`,
      };
    }
    containerId = sandboxInfo.containerId;
  }

  if (!containerId) {
    return {
      success: false,
      error: 'Could not determine container ID',
    };
  }

  // Get logs
  const logs = await getContainerLogs(containerId, { tail: 200 });
  const errorOutput = logs.stderr || logs.stdout;

  // Analyze errors
  const suggestions = analyzeError(errorOutput);

  return {
    success: true,
    data: {
      hasErrors: suggestions.length > 0,
      suggestions,
      logs,
    },
  };
}

/**
 * Auto-fix detected errors (for agents)
 */
export async function agentAutoFix(
  context: AgentToolContext,
  options: {
    error?: string;
    maxAttempts?: number;
  } = {}
): Promise<ToolResult<{
  resolved: boolean;
  attempts: Array<{ command: string; success: boolean; output: string }>;
  finalError?: string;
}>> {
  // Get container ID
  let containerId: string | undefined;
  if (context.containerId) {
    containerId = context.containerId;
  } else if (context.sessionId) {
    const sandboxInfo = await getSandboxInfo(context.sessionId);
    if (!sandboxInfo) {
      return {
        success: false,
        error: `Sandbox session ${context.sessionId} not found`,
      };
    }
    containerId = sandboxInfo.containerId;
  }

  if (!containerId) {
    return {
      success: false,
      error: 'Could not determine container ID',
    };
  }

  // Get error to fix
  let errorToFix = options.error;
  if (!errorToFix) {
    const logs = await getContainerLogs(containerId, { tail: 200 });
    errorToFix = logs.stderr || logs.stdout;
  }

  if (!errorToFix) {
    return {
      success: true,
      data: {
        resolved: true,
        attempts: [],
      },
    };
  }

  // Run auto-resolution
  const result = await autoResolveError(containerId, errorToFix, {
    maxAttempts: options.maxAttempts || 3,
  });

  return {
    success: result.resolved,
    data: {
      resolved: result.resolved,
      attempts: result.attempts.map(a => ({
        command: a.command,
        success: a.result.success,
        output: a.result.stdout || a.result.stderr,
      })),
      finalError: result.finalError,
    },
    error: result.resolved ? undefined : 'Could not automatically resolve all errors',
  };
}

/**
 * Read a file from the container (for agents)
 */
export async function agentReadFile(
  filePath: string,
  context: AgentToolContext
): Promise<ToolResult<string>> {
  const command = `cat ${filePath}`;
  const result = await agentExecuteCommand(command, context);
  
  if (result.success && result.data) {
    return {
      success: true,
      data: result.data.stdout,
    };
  }
  
  return {
    success: false,
    error: result.error || 'Failed to read file',
  };
}

/**
 * List files in a directory (for agents)
 */
export async function agentListFiles(
  dirPath: string,
  context: AgentToolContext
): Promise<ToolResult<string[]>> {
  const command = `ls -la ${dirPath}`;
  const result = await agentExecuteCommand(command, context);
  
  if (result.success && result.data) {
    const files = result.data.stdout
      .split('\n')
      .slice(1) // Skip total line
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split(/\s+/);
        return parts[parts.length - 1];
      })
      .filter(name => name && name !== '.' && name !== '..');
    
    return {
      success: true,
      data: files,
    };
  }
  
  return {
    success: false,
    error: result.error || 'Failed to list files',
  };
}

/**
 * Check TypeScript errors (for agents)
 */
export async function agentCheckTypes(
  context: AgentToolContext
): Promise<ToolResult<{ errors: string[]; hasErrors: boolean }>> {
  const result = await agentExecuteCommand('npx tsc --noEmit', context);
  
  const errors = result.data?.stderr
    ?.split('\n')
    .filter(line => line.includes('error TS')) || [];
  
  return {
    success: true,
    data: {
      errors,
      hasErrors: errors.length > 0,
    },
  };
}

/**
 * Run linter and optionally fix issues (for agents)
 */
export async function agentLint(
  context: AgentToolContext,
  options: { fix?: boolean } = {}
): Promise<ToolResult<{ output: string; hasErrors: boolean }>> {
  const command = options.fix ? 'npx eslint . --fix' : 'npx eslint .';
  const result = await agentExecuteCommand(command, context);
  
  return {
    success: true,
    data: {
      output: result.data?.stdout || result.data?.stderr || '',
      hasErrors: !result.success,
    },
  };
}

// Export all tools for easy access
export const agentTools = {
  executeCommand: agentExecuteCommand,
  installPackage: agentInstallPackage,
  runScript: agentRunScript,
  analyzeErrors: agentAnalyzeErrors,
  autoFix: agentAutoFix,
  readFile: agentReadFile,
  listFiles: agentListFiles,
  checkTypes: agentCheckTypes,
  lint: agentLint,
};
