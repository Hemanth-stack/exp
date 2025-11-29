import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import simpleGit from 'simple-git';

const execAsync = promisify(exec);

const PROJECT_ROOT = process.cwd();

// Command whitelist
const ALLOWED_COMMANDS = ['npm', 'npx', 'node', 'git', 'cat', 'ls', 'find', 'grep', 'curl', 'echo', 'pwd'];
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /sudo/,
  /chmod\s+777/,
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\//,
];

function validatePath(filePath: string): string {
  const normalized = path.normalize(filePath);
  const absolute = path.isAbsolute(normalized) ? normalized : path.join(PROJECT_ROOT, normalized);
  
  if (!absolute.startsWith(PROJECT_ROOT)) {
    throw new Error('Access denied: Path is outside project directory');
  }
  
  return absolute;
}

function validateCommand(command: string): void {
  const firstCommand = command.trim().split(/\s+/)[0].split('/').pop() || '';
  
  if (!ALLOWED_COMMANDS.includes(firstCommand)) {
    throw new Error(`Command not allowed: ${firstCommand}`);
  }
  
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error('Dangerous command detected');
    }
  }
}

export const toolExecutors = {
  async read_file(args: { path: string; start_line?: number; end_line?: number }) {
    try {
      const filePath = validatePath(args.path);
      const content = await fs.readFile(filePath, 'utf-8');
      
      if (args.start_line !== undefined || args.end_line !== undefined) {
        const lines = content.split('\n');
        const start = (args.start_line || 1) - 1;
        const end = args.end_line || lines.length;
        return {
          success: true,
          content: lines.slice(start, end).join('\n'),
          lines: `${start + 1}-${end}`,
          total_lines: lines.length,
        };
      }
      
      return {
        success: true,
        content,
        lines: content.split('\n').length,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },

  async write_file(args: { path: string; content: string }) {
    try {
      const filePath = validatePath(args.path);
      const dir = path.dirname(filePath);
      
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, args.content, 'utf-8');
      
      return {
        success: true,
        message: `File written: ${args.path}`,
        bytes: Buffer.byteLength(args.content, 'utf-8'),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },

  async edit_file(args: { path: string; old_content: string; new_content: string }) {
    try {
      const filePath = validatePath(args.path);
      const content = await fs.readFile(filePath, 'utf-8');
      
      if (!content.includes(args.old_content)) {
        return {
          success: false,
          error: 'Old content not found in file. Make sure it matches exactly.',
        };
      }
      
      const newContent = content.replace(args.old_content, args.new_content);
      await fs.writeFile(filePath, newContent, 'utf-8');
      
      return {
        success: true,
        message: `File edited: ${args.path}`,
        changes: args.old_content.length !== args.new_content.length
          ? `${args.old_content.length} bytes → ${args.new_content.length} bytes`
          : 'Content replaced',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },

  async delete_file(args: { path: string }) {
    try {
      const filePath = validatePath(args.path);
      await fs.unlink(filePath);
      
      return {
        success: true,
        message: `File deleted: ${args.path}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },

  async list_directory(args: { path: string; recursive?: boolean }) {
    try {
      const dirPath = validatePath(args.path);
      
      async function listDir(dir: string, prefix = ''): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const results: string[] = [];
        
        for (const entry of entries) {
          const relativePath = path.join(prefix, entry.name);
          if (entry.isDirectory()) {
            results.push(`${relativePath}/`);
            if (args.recursive) {
              const subResults = await listDir(path.join(dir, entry.name), relativePath);
              results.push(...subResults);
            }
          } else {
            results.push(relativePath);
          }
        }
        
        return results;
      }
      
      const files = await listDir(dirPath);
      
      return {
        success: true,
        files,
        count: files.length,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },

  async execute_command(args: { command: string; timeout?: number }) {
    try {
      validateCommand(args.command);
      
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: PROJECT_ROOT,
        timeout: (args.timeout || 60) * 1000,
        maxBuffer: 1024 * 1024 * 10, // 10MB
      });
      
      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout?.trim() || '',
        stderr: error.stderr?.trim() || '',
      };
    }
  },

  async git_status() {
    try {
      const git = simpleGit(PROJECT_ROOT);
      const status = await git.status();
      
      return {
        success: true,
        modified: status.modified,
        created: status.created,
        deleted: status.deleted,
        staged: status.staged,
        conflicted: status.conflicted,
        branch: status.current,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },

  async git_commit(args: { message: string; stage_all?: boolean }) {
    try {
      const git = simpleGit(PROJECT_ROOT);
      
      if (args.stage_all) {
        await git.add('.');
      }
      
      const result = await git.commit(args.message);
      
      return {
        success: true,
        commit: result.commit,
        summary: result.summary,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },

  async git_log(args?: { limit?: number }) {
    try {
      const git = simpleGit(PROJECT_ROOT);
      const log = await git.log({ maxCount: args?.limit || 10 });
      
      return {
        success: true,
        commits: log.all.map(commit => ({
          hash: commit.hash.substring(0, 7),
          message: commit.message,
          author: commit.author_name,
          date: commit.date,
        })),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },

  async git_diff(args?: { path?: string }) {
    try {
      const git = simpleGit(PROJECT_ROOT);
      const diff = args?.path
        ? await git.diff([args.path])
        : await git.diff();
      
      return {
        success: true,
        diff: diff.trim(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },

  async npm_install(args: { packages: string[]; dev?: boolean }) {
    try {
      const devFlag = args.dev ? '--save-dev' : '';
      const command = `npm install ${devFlag} ${args.packages.join(' ')}`;
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: PROJECT_ROOT,
        timeout: 300000, // 5 minutes
      });
      
      return {
        success: true,
        packages: args.packages,
        stdout: stdout.trim(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },

  async search_files(args: { query: string; file_pattern?: string }) {
    try {
      const pattern = args.file_pattern || '*';
      const command = `grep -r "${args.query}" --include="${pattern}" .`;
      
      const { stdout } = await execAsync(command, {
        cwd: PROJECT_ROOT,
        maxBuffer: 1024 * 1024 * 10,
      });
      
      const results = stdout.trim().split('\n').filter(Boolean);
      
      return {
        success: true,
        matches: results,
        count: results.length,
      };
    } catch (error: any) {
      // Grep returns exit code 1 when no matches found
      if (error.code === 1) {
        return {
          success: true,
          matches: [],
          count: 0,
        };
      }
      return {
        success: false,
        error: error.message,
      };
    }
  },

  async update_todo(args: { current_task: string; completed?: string[]; remaining?: string[] }) {
    return {
      success: true,
      message: 'Task progress updated',
      current: args.current_task,
      completed: args.completed || [],
      remaining: args.remaining || [],
    };
  },
};

export type ToolName = keyof typeof toolExecutors;
export type ToolArgs = Parameters<typeof toolExecutors[ToolName]>[0];
export type ToolResult = ReturnType<typeof toolExecutors[ToolName]>;
