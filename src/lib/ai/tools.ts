import Anthropic from '@anthropic-ai/sdk';

export const AI_TOOLS: Anthropic.Beta.Tools.Tool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Can optionally specify line range to read only a portion of the file.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file relative to project root',
        },
        start_line: {
          type: 'number',
          description: 'Starting line number (1-indexed, optional)',
        },
        end_line: {
          type: 'number',
          description: 'Ending line number (1-indexed, optional)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a new file or completely overwrite an existing file with the provided content.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file relative to project root',
        },
        content: {
          type: 'string',
          description: 'Complete content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Edit a file by finding and replacing specific content. More precise than write_file for modifications.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file relative to project root',
        },
        old_content: {
          type: 'string',
          description: 'Exact content to find and replace (must match exactly)',
        },
        new_content: {
          type: 'string',
          description: 'New content to replace with',
        },
      },
      required: ['path', 'old_content', 'new_content'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the project.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file relative to project root',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_directory',
    description: 'List contents of a directory, optionally recursively.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the directory relative to project root',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list recursively (default: false)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'execute_command',
    description: 'Execute a shell command. Allowed commands: npm, npx, node, git, cat, ls, find, grep, curl. Dangerous commands are blocked.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default: 60)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'git_status',
    description: 'Get the status of the git repository, including changed and staged files.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'git_commit',
    description: 'Commit staged changes with a message.',
    input_schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Commit message',
        },
        stage_all: {
          type: 'boolean',
          description: 'Stage all changes before committing (default: false)',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'git_log',
    description: 'Get recent commit history.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of commits to retrieve (default: 10)',
        },
      },
    },
  },
  {
    name: 'git_diff',
    description: 'Get diff of changes in a file or all changes.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to specific file (optional, shows all changes if not provided)',
        },
      },
    },
  },
  {
    name: 'npm_install',
    description: 'Install npm packages.',
    input_schema: {
      type: 'object',
      properties: {
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of package names to install',
        },
        dev: {
          type: 'boolean',
          description: 'Install as dev dependencies (default: false)',
        },
      },
      required: ['packages'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for text content across project files (grep-like search).',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text or regex pattern to search for',
        },
        file_pattern: {
          type: 'string',
          description: 'File pattern to search in (e.g., "*.ts", "src/**/*.tsx")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'update_todo',
    description: 'Update the task progress and TODO list. Use this to track what you\'re working on.',
    input_schema: {
      type: 'object',
      properties: {
        current_task: {
          type: 'string',
          description: 'What you are currently working on',
        },
        completed: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tasks completed in this session',
        },
        remaining: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tasks remaining to be done',
        },
      },
      required: ['current_task'],
    },
  },
];
