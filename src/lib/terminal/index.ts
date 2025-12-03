/**
 * Terminal Module
 * 
 * Re-exports terminal service functionality and provides additional utilities
 * for the chat console and agent system.
 */

// Re-export everything from terminal-service
export {
  type CommandResult,
  type TerminalSession,
  isCommandAllowed,
  executeCommand,
  analyzeError,
  autoResolveError,
  getContainerStats,
  getContainerLogs,
} from '../terminal-service';

/**
 * Terminal command categories for UI display
 */
export type CommandCategory = 
  | 'package' 
  | 'build' 
  | 'test' 
  | 'lint' 
  | 'git' 
  | 'filesystem' 
  | 'process' 
  | 'other';

/**
 * Categorize a command for UI display
 */
export function categorizeCommand(command: string): CommandCategory {
  const trimmed = command.trim().toLowerCase();
  
  if (/^(npm|yarn|pnpm)\s+(install|add|remove|uninstall|update)/.test(trimmed)) {
    return 'package';
  }
  if (/^(npm|yarn|pnpm)\s+(run\s+)?(build|dev|start)/.test(trimmed)) {
    return 'build';
  }
  if (/^(npm|yarn|pnpm)\s+(run\s+)?(test|jest|vitest)/.test(trimmed) || /^(jest|vitest)/.test(trimmed)) {
    return 'test';
  }
  if (/^(npm|yarn|pnpm)\s+(run\s+)?lint/.test(trimmed) || /^(eslint|prettier|tsc)/.test(trimmed)) {
    return 'lint';
  }
  if (/^git\s+/.test(trimmed)) {
    return 'git';
  }
  if (/^(ls|cat|head|tail|pwd|find|tree|wc|du|df)/.test(trimmed)) {
    return 'filesystem';
  }
  if (/^(ps|top|kill|pkill)/.test(trimmed)) {
    return 'process';
  }
  
  return 'other';
}

/**
 * Get icon for command category
 */
export function getCategoryIcon(category: CommandCategory): string {
  const icons: Record<CommandCategory, string> = {
    package: '📦',
    build: '🔨',
    test: '🧪',
    lint: '🔍',
    git: '📚',
    filesystem: '📁',
    process: '⚙️',
    other: '💻',
  };
  return icons[category];
}

/**
 * Format command result for display
 */
export function formatCommandResult(result: {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
}): string {
  const lines: string[] = [];
  
  if (result.stdout) {
    lines.push(result.stdout);
  }
  
  if (result.stderr) {
    if (result.success) {
      // Warnings
      lines.push(`⚠️ ${result.stderr}`);
    } else {
      lines.push(`❌ ${result.stderr}`);
    }
  }
  
  lines.push(`\n⏱️ ${result.executionTime}ms | Exit: ${result.exitCode}`);
  
  return lines.join('\n');
}

/**
 * Parse npm/yarn output to extract meaningful info
 */
export function parsePackageManagerOutput(output: string): {
  packagesAdded: string[];
  packagesRemoved: string[];
  warnings: string[];
  errors: string[];
} {
  const packagesAdded: string[] = [];
  const packagesRemoved: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  
  const lines = output.split('\n');
  
  for (const line of lines) {
    // npm added packages
    const addedMatch = line.match(/added (\d+) packages?/);
    if (addedMatch) {
      packagesAdded.push(`${addedMatch[1]} packages`);
    }
    
    // npm removed packages
    const removedMatch = line.match(/removed (\d+) packages?/);
    if (removedMatch) {
      packagesRemoved.push(`${removedMatch[1]} packages`);
    }
    
    // Warnings
    if (line.toLowerCase().includes('warn') || line.includes('⚠')) {
      warnings.push(line.trim());
    }
    
    // Errors
    if (line.toLowerCase().includes('error') || line.toLowerCase().includes('err!')) {
      errors.push(line.trim());
    }
  }
  
  return { packagesAdded, packagesRemoved, warnings, errors };
}

/**
 * Common quick commands for the terminal
 */
export const QUICK_COMMANDS = [
  { command: 'npm install', label: 'Install deps', category: 'package' as CommandCategory },
  { command: 'npm run dev', label: 'Start dev', category: 'build' as CommandCategory },
  { command: 'npm run build', label: 'Build', category: 'build' as CommandCategory },
  { command: 'npm run lint', label: 'Lint', category: 'lint' as CommandCategory },
  { command: 'npm test', label: 'Test', category: 'test' as CommandCategory },
  { command: 'ls -la', label: 'List files', category: 'filesystem' as CommandCategory },
  { command: 'git status', label: 'Git status', category: 'git' as CommandCategory },
  { command: 'pwd', label: 'Current dir', category: 'filesystem' as CommandCategory },
];

/**
 * Streaming terminal session for real-time output
 */
export interface StreamingSession {
  id: string;
  containerId: string;
  command: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  startTime: Date;
  output: string;
  onOutput?: (chunk: string) => void;
  onComplete?: (result: { exitCode: number; output: string }) => void;
  onError?: (error: Error) => void;
  cancel: () => void;
}

/**
 * Terminal history entry
 */
export interface TerminalHistoryEntry {
  id: string;
  command: string;
  result: {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
    executionTime: number;
  };
  timestamp: Date;
  category: CommandCategory;
}

/**
 * Create a formatted terminal prompt
 */
export function formatPrompt(workDir: string = '/app'): string {
  const dir = workDir.replace('/app', '~');
  return `\x1b[32m➜\x1b[0m \x1b[36m${dir}\x1b[0m $ `;
}

/**
 * Truncate long output for display
 */
export function truncateOutput(output: string, maxLines: number = 50): {
  truncated: string;
  totalLines: number;
  wasTrancated: boolean;
} {
  const lines = output.split('\n');
  const totalLines = lines.length;
  
  if (totalLines <= maxLines) {
    return { truncated: output, totalLines, wasTrancated: false };
  }
  
  const truncated = [
    ...lines.slice(0, Math.floor(maxLines / 2)),
    `\n... (${totalLines - maxLines} lines hidden) ...\n`,
    ...lines.slice(-Math.floor(maxLines / 2)),
  ].join('\n');
  
  return { truncated, totalLines, wasTrancated: true };
}

/**
 * Check if command might be long-running
 */
export function isLongRunningCommand(command: string): boolean {
  const longRunningPatterns = [
    /npm\s+(run\s+)?(dev|start|watch)/,
    /yarn\s+(dev|start|watch)/,
    /pnpm\s+(dev|start|watch)/,
    /nodemon/,
    /next\s+dev/,
    /vite(\s+dev)?$/,
    /webpack.*--watch/,
  ];
  
  return longRunningPatterns.some(pattern => pattern.test(command.trim()));
}

/**
 * Suggest related commands based on current command
 */
export function suggestRelatedCommands(command: string): string[] {
  const suggestions: string[] = [];
  const trimmed = command.trim().toLowerCase();
  
  if (trimmed.includes('npm install')) {
    suggestions.push('npm run dev', 'npm run build', 'npm test');
  } else if (trimmed.includes('npm run build')) {
    suggestions.push('npm start', 'npm run preview');
  } else if (trimmed.includes('npm test')) {
    suggestions.push('npm run test:watch', 'npm run test:coverage');
  } else if (trimmed.includes('git status')) {
    suggestions.push('git diff', 'git log --oneline -5');
  } else if (trimmed.startsWith('ls')) {
    suggestions.push('cat package.json', 'tree -L 2');
  }
  
  return suggestions;
}
