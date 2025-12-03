/**
 * Terminal Service
 * Provides secure command execution inside Docker containers
 * with command whitelisting and error auto-resolution
 */

import Dockerode from 'dockerode';
import { Writable } from 'stream';

const docker = new Dockerode({
  socketPath: process.platform === 'win32' 
    ? '//./pipe/docker_engine' 
    : '/var/run/docker.sock'
});

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
}

export interface TerminalSession {
  containerId: string;
  sessionId: string;
  history: Array<{
    command: string;
    result: CommandResult;
    timestamp: Date;
  }>;
}

// Command whitelist patterns for security
const ALLOWED_COMMAND_PATTERNS: RegExp[] = [
  // Package management
  /^npm\s+(install|i|add|remove|rm|uninstall|update|outdated|list|ls|run|test|start|build|lint|audit|ci)(\s+.*)?$/,
  /^npx\s+[\w@\/-]+(\s+.*)?$/,
  /^yarn\s+(install|add|remove|upgrade|list|run|test|start|build|lint|audit)(\s+.*)?$/,
  /^pnpm\s+(install|add|remove|update|list|run|test|start|build|lint|audit)(\s+.*)?$/,
  
  // File system (read-only and safe operations)
  /^ls(\s+-[alhrRtS]+)?(\s+[\w\/.@-]+)?$/,
  /^cat\s+[\w\/.@-]+$/,
  /^head(\s+-n\s*\d+)?\s+[\w\/.@-]+$/,
  /^tail(\s+-n\s*\d+)?\s+[\w\/.@-]+$/,
  /^pwd$/,
  /^find\s+[\w\/.@-]+\s+-name\s+["']?[\w.*-]+["']?(\s+-type\s+[fd])?$/,
  /^tree(\s+-L\s*\d+)?(\s+[\w\/.@-]+)?$/,
  /^wc(\s+-[lwc]+)?\s+[\w\/.@-]+$/,
  /^du(\s+-[sh]+)?(\s+[\w\/.@-]+)?$/,
  /^df(\s+-h)?$/,
  
  // Development tools
  /^tsc(\s+--[\w-]+)*$/,
  /^eslint(\s+[\w\/.@-]+)?(\s+--fix)?$/,
  /^prettier(\s+--[\w-]+)*(\s+[\w\/.@-]+)?$/,
  /^jest(\s+[\w\/.@-]+)?(\s+--[\w-]+)*$/,
  /^vitest(\s+[\w\/.@-]+)?(\s+--[\w-]+)*$/,
  
  // Git (read-only)
  /^git\s+(status|log|diff|branch|show|blame)(\s+.*)?$/,
  
  // Process info
  /^ps(\s+aux)?$/,
  /^top\s+-b\s+-n\s*1$/,
  
  // Network diagnostics
  /^curl\s+(-I\s+)?https?:\/\/[\w\/.:-]+$/,
  /^ping\s+-c\s*\d+\s+[\w.-]+$/,
  
  // Environment
  /^env$/,
  /^echo\s+\$[\w_]+$/,
  /^node\s+-v$/,
  /^npm\s+-v$/,
  /^which\s+[\w-]+$/,
];

// Dangerous patterns that should always be blocked
const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf?\s+[\/~]/,      // Dangerous rm operations
  />\s*\/dev\//,            // Writing to devices
  /mkfs/,                   // Filesystem operations
  /dd\s+if=/,               // Raw disk operations
  /:(){ :|:& };:/,          // Fork bomb
  /wget.*\|.*sh/,           // Piped execution
  /curl.*\|.*sh/,           // Piped execution
  /eval\s+/,                // Eval execution
  /exec\s+/,                // Exec replacement
  /sudo/,                   // Privilege escalation
  /su\s+-/,                 // User switching
  /chmod\s+777/,            // Overly permissive
  /chown.*root/,            // Ownership changes
  /\.\.\/.*\.\.\//,         // Path traversal
];

/**
 * Validate if a command is allowed to be executed
 */
export function isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
  const trimmedCommand = command.trim();
  
  // Check for empty command
  if (!trimmedCommand) {
    return { allowed: false, reason: 'Empty command' };
  }
  
  // Check for blocked patterns first
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      return { allowed: false, reason: 'Command contains blocked pattern for security' };
    }
  }
  
  // Check against whitelist
  for (const pattern of ALLOWED_COMMAND_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      return { allowed: true };
    }
  }
  
  return { 
    allowed: false, 
    reason: 'Command not in whitelist. Allowed: npm, npx, yarn, ls, cat, pwd, git (read), tsc, eslint, prettier' 
  };
}

/**
 * Execute a command inside a Docker container
 */
export async function executeCommand(
  containerId: string,
  command: string,
  options: {
    timeout?: number;
    workDir?: string;
    env?: Record<string, string>;
  } = {}
): Promise<CommandResult> {
  const { timeout = 60000, workDir = '/app', env = {} } = options;
  const startTime = Date.now();
  
  // Validate command
  const validation = isCommandAllowed(command);
  if (!validation.allowed) {
    return {
      success: false,
      stdout: '',
      stderr: `Command rejected: ${validation.reason}`,
      exitCode: -1,
      executionTime: 0,
    };
  }
  
  try {
    const container = docker.getContainer(containerId);
    
    // Check if container exists and is running
    const containerInfo = await container.inspect();
    if (!containerInfo.State.Running) {
      return {
        success: false,
        stdout: '',
        stderr: 'Container is not running',
        exitCode: -1,
        executionTime: Date.now() - startTime,
      };
    }
    
    // Create exec instance
    const exec = await container.exec({
      Cmd: ['sh', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: workDir,
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    });
    
    // Start execution with timeout
    const stream = await exec.start({ hijack: true, stdin: false });
    
    let stdout = '';
    let stderr = '';
    
    // Create output collectors
    const stdoutCollector = new Writable({
      write(chunk, _encoding, callback) {
        stdout += chunk.toString();
        callback();
      }
    });
    
    const stderrCollector = new Writable({
      write(chunk, _encoding, callback) {
        stderr += chunk.toString();
        callback();
      }
    });
    
    // Demux the stream (Docker multiplexes stdout and stderr)
    docker.modem.demuxStream(stream, stdoutCollector, stderrCollector);
    
    // Wait for completion with timeout
    const result = await Promise.race([
      new Promise<{ exitCode: number }>((resolve, reject) => {
        stream.on('end', async () => {
          try {
            const inspectResult = await exec.inspect();
            resolve({ exitCode: inspectResult.ExitCode || 0 });
          } catch (err) {
            reject(err);
          }
        });
        stream.on('error', reject);
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Command timeout')), timeout);
      }),
    ]);
    
    const executionTime = Date.now() - startTime;
    
    // Clean up output (remove Docker stream headers if present)
    stdout = cleanDockerOutput(stdout);
    stderr = cleanDockerOutput(stderr);
    
    return {
      success: result.exitCode === 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: result.exitCode,
      executionTime,
    };
    
  } catch (error) {
    const executionTime = Date.now() - startTime;
    return {
      success: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : 'Unknown error',
      exitCode: -1,
      executionTime,
    };
  }
}

/**
 * Clean Docker multiplexed stream output
 */
function cleanDockerOutput(output: string): string {
  // Remove binary stream headers that Docker adds
  return output.replace(/[\x00-\x08]/g, '').trim();
}

/**
 * Error patterns and their auto-fix commands
 */
interface ErrorPattern {
  pattern: RegExp;
  extractInfo?: (match: RegExpMatchArray, fullError: string) => Record<string, string>;
  fixCommand: (info: Record<string, string>) => string;
  description: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // Missing npm package
  {
    pattern: /Cannot find module ['"]([^'"]+)['"]/,
    extractInfo: (match) => ({ packageName: match[1].split('/')[0] }),
    fixCommand: (info) => `npm install ${info.packageName}`,
    description: 'Install missing npm package',
  },
  {
    pattern: /Module not found: Can't resolve ['"]([^'"]+)['"]/,
    extractInfo: (match) => ({ packageName: match[1].split('/')[0] }),
    fixCommand: (info) => `npm install ${info.packageName}`,
    description: 'Install missing module',
  },
  // Missing type definitions
  {
    pattern: /Could not find a declaration file for module ['"]([^'"]+)['"]/,
    extractInfo: (match) => ({ packageName: match[1] }),
    fixCommand: (info) => `npm install -D @types/${info.packageName.replace('@', '').replace('/', '__')}`,
    description: 'Install missing TypeScript types',
  },
  // TypeScript errors - run tsc
  {
    pattern: /error TS\d+:/,
    extractInfo: () => ({}),
    fixCommand: () => 'npx tsc --noEmit',
    description: 'Check TypeScript errors',
  },
  // ESLint errors
  {
    pattern: /eslint.*error|✖ \d+ problems?/i,
    extractInfo: () => ({}),
    fixCommand: () => 'npx eslint . --fix',
    description: 'Auto-fix ESLint errors',
  },
  // Node modules missing
  {
    pattern: /node_modules.*ENOENT|Cannot find package/,
    extractInfo: () => ({}),
    fixCommand: () => 'npm install',
    description: 'Install all dependencies',
  },
  // Peer dependency issues
  {
    pattern: /peer dep missing|ERESOLVE|peer dependency/i,
    extractInfo: () => ({}),
    fixCommand: () => 'npm install --legacy-peer-deps',
    description: 'Install with legacy peer deps',
  },
  // Lock file issues
  {
    pattern: /package-lock\.json.*conflict|ELOCKVERIFY/,
    extractInfo: () => ({}),
    fixCommand: () => 'rm -f package-lock.json && npm install',
    description: 'Regenerate lock file',
  },
  // Build cache issues
  {
    pattern: /\.next.*error|NEXT.*cache/i,
    extractInfo: () => ({}),
    fixCommand: () => 'rm -rf .next && npm run build',
    description: 'Clear Next.js cache and rebuild',
  },
  // Port already in use
  {
    pattern: /EADDRINUSE.*port (\d+)|Port (\d+) is already in use/,
    extractInfo: (match) => ({ port: match[1] || match[2] }),
    fixCommand: () => 'pkill -f "node" || true',
    description: 'Kill processes using the port',
  },
];

/**
 * Analyze an error and suggest fix commands
 */
export function analyzeError(error: string): Array<{
  command: string;
  description: string;
  confidence: number;
}> {
  const suggestions: Array<{
    command: string;
    description: string;
    confidence: number;
  }> = [];
  
  for (const errorPattern of ERROR_PATTERNS) {
    const match = error.match(errorPattern.pattern);
    if (match) {
      const info = errorPattern.extractInfo ? errorPattern.extractInfo(match, error) : {};
      suggestions.push({
        command: errorPattern.fixCommand(info),
        description: errorPattern.description,
        confidence: 0.8,
      });
    }
  }
  
  return suggestions;
}

/**
 * Auto-resolve errors by executing fix commands
 */
export async function autoResolveError(
  containerId: string,
  error: string,
  options: {
    maxAttempts?: number;
    onProgress?: (step: { command: string; result: CommandResult }) => void;
  } = {}
): Promise<{
  resolved: boolean;
  attempts: Array<{ command: string; result: CommandResult }>;
  finalError?: string;
}> {
  const { maxAttempts = 3, onProgress } = options;
  const attempts: Array<{ command: string; result: CommandResult }> = [];
  
  let currentError = error;
  let attemptCount = 0;
  
  while (attemptCount < maxAttempts) {
    const suggestions = analyzeError(currentError);
    
    if (suggestions.length === 0) {
      break;
    }
    
    // Try the highest confidence suggestion
    const suggestion = suggestions[0];
    
    console.log(`[Terminal Service] Auto-fix attempt ${attemptCount + 1}: ${suggestion.description}`);
    console.log(`[Terminal Service] Running: ${suggestion.command}`);
    
    const result = await executeCommand(containerId, suggestion.command);
    
    attempts.push({ command: suggestion.command, result });
    
    if (onProgress) {
      onProgress({ command: suggestion.command, result });
    }
    
    if (result.success) {
      // Verify the fix by checking if error persists
      // For now, assume success means resolved
      return {
        resolved: true,
        attempts,
      };
    }
    
    // Update error for next iteration
    currentError = result.stderr || result.stdout;
    attemptCount++;
  }
  
  return {
    resolved: false,
    attempts,
    finalError: currentError,
  };
}

/**
 * Get container status and resource usage
 */
export async function getContainerStats(containerId: string): Promise<{
  status: string;
  cpu: number;
  memory: { used: number; limit: number };
  uptime: number;
} | null> {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    const stats = await container.stats({ stream: false });
    
    // Calculate CPU percentage
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;
    
    // Memory usage
    const memoryUsed = stats.memory_stats.usage || 0;
    const memoryLimit = stats.memory_stats.limit || 0;
    
    // Uptime
    const startedAt = new Date(info.State.StartedAt).getTime();
    const uptime = Date.now() - startedAt;
    
    return {
      status: info.State.Status,
      cpu: Math.round(cpuPercent * 100) / 100,
      memory: {
        used: memoryUsed,
        limit: memoryLimit,
      },
      uptime,
    };
  } catch (error) {
    console.error('[Terminal Service] Error getting container stats:', error);
    return null;
  }
}

/**
 * Get container logs (non-streaming)
 */
export async function getContainerLogs(
  containerId: string,
  options: { tail?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  const { tail = 100 } = options;
  
  try {
    const container = docker.getContainer(containerId);
    
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      follow: false,
      timestamps: true,
    } as { stdout: true; stderr: true; tail: number; follow: false; timestamps: true });
    
    const output = logs.toString();
    
    // Parse stdout and stderr from Docker multiplexed output
    let stdout = '';
    let stderr = '';
    
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.length > 8) {
        // First byte indicates stream type (1 = stdout, 2 = stderr)
        const streamType = line.charCodeAt(0);
        const content = line.slice(8);
        if (streamType === 2) {
          stderr += content + '\n';
        } else {
          stdout += content + '\n';
        }
      }
    }
    
    return {
      stdout: cleanDockerOutput(stdout.trim()),
      stderr: cleanDockerOutput(stderr.trim()),
    };
  } catch (error) {
    console.error('[Terminal Service] Error getting logs:', error);
    return { stdout: '', stderr: error instanceof Error ? error.message : 'Unknown error' };
  }
}
