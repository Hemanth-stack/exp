# Terminal Execution Feature

This document describes the terminal execution feature that enables agents and users to run commands inside sandbox containers with automatic error detection and resolution.

## Overview

The terminal execution feature provides:

1. **Secure Command Execution** - Whitelisted commands that can be safely run in sandbox containers
2. **Error Auto-Resolution** - Automatic detection and fixing of common errors
3. **Agent Tools** - API for AI agents to execute commands and fix issues
4. **User Interface** - Terminal component for interactive command execution

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User/Agent Request                      │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Endpoints                             │
│  /api/sandbox/[sessionId]/exec     - Execute commands       │
│  /api/sandbox/[sessionId]/autofix  - Auto-fix errors        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Terminal Service                            │
│  - Command validation & whitelist                           │
│  - Docker exec integration                                  │
│  - Error pattern analysis                                   │
│  - Auto-resolution logic                                    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Docker Container                           │
│  - Isolated sandbox environment                             │
│  - Node.js 20 runtime                                       │
│  - Next.js/Vite project                                     │
└─────────────────────────────────────────────────────────────┘
```

## API Endpoints

### Execute Command

```http
POST /api/sandbox/{sessionId}/exec
Content-Type: application/json

{
  "command": "npm install lodash",
  "workDir": "/app",
  "timeout": 60000,
  "autoFix": true
}
```

Response:
```json
{
  "success": true,
  "allowed": true,
  "result": {
    "success": true,
    "stdout": "added 1 package...",
    "stderr": "",
    "exitCode": 0,
    "executionTime": 2340
  },
  "autoFix": null
}
```

### Auto-Fix Errors

```http
POST /api/sandbox/{sessionId}/autofix
Content-Type: application/json

{
  "error": "Cannot find module 'lodash'",
  "maxAttempts": 3
}
```

Response:
```json
{
  "success": true,
  "message": "Error resolved successfully",
  "resolved": true,
  "attempts": [
    {
      "command": "npm install lodash",
      "success": true,
      "output": "added 1 package...",
      "executionTime": 2340
    }
  ],
  "suggestions": [
    {
      "command": "npm install lodash",
      "description": "Install missing npm package"
    }
  ]
}
```

### Get Container Status

```http
GET /api/sandbox/{sessionId}/exec?action=status
```

```http
GET /api/sandbox/{sessionId}/exec?action=logs&tail=100
```

```http
GET /api/sandbox/{sessionId}/exec?action=analyze
```

## Allowed Commands (Whitelist)

### Package Management
- `npm install`, `npm i`, `npm add`, `npm remove`, `npm run`, `npm test`, `npm build`, `npm lint`
- `npx <package>`
- `yarn install`, `yarn add`, `yarn remove`, `yarn run`
- `pnpm install`, `pnpm add`, `pnpm remove`, `pnpm run`

### File System (Read-only)
- `ls`, `ls -la`, `ls -alh`
- `cat <file>`
- `head`, `tail`
- `pwd`
- `find`, `tree`
- `wc`, `du`, `df`

### Development Tools
- `tsc`, `tsc --noEmit`
- `eslint`, `eslint --fix`
- `prettier`
- `jest`, `vitest`

### Git (Read-only)
- `git status`, `git log`, `git diff`, `git branch`, `git show`, `git blame`

### Process/System Info
- `ps`, `ps aux`
- `env`
- `node -v`, `npm -v`
- `which`

## Error Auto-Resolution

The system can automatically detect and fix these common errors:

| Error Pattern | Auto-Fix Command | Description |
|--------------|------------------|-------------|
| `Cannot find module 'X'` | `npm install X` | Install missing package |
| `Module not found: Can't resolve 'X'` | `npm install X` | Install missing module |
| `Could not find declaration file for 'X'` | `npm install -D @types/X` | Install TypeScript types |
| `error TS\d+:` | `npx tsc --noEmit` | TypeScript type check |
| `eslint.*error` | `npx eslint . --fix` | Auto-fix ESLint errors |
| `node_modules.*ENOENT` | `npm install` | Install all dependencies |
| `peer dep missing` | `npm install --legacy-peer-deps` | Fix peer dependency issues |
| `.next.*error` | `rm -rf .next && npm run build` | Clear Next.js cache |

## Agent Integration

### Using Agent Tools

```typescript
import { agentTools, AgentToolContext } from '@/lib/agent-tools';

const context: AgentToolContext = {
  sessionId: 'abc123...',
  projectPath: '/app',
};

// Execute a command
const result = await agentTools.executeCommand('npm run build', context);

// Install a package
await agentTools.installPackage('lodash', context);
await agentTools.installPackage('@types/lodash', context, { dev: true });

// Check for errors
const analysis = await agentTools.analyzeErrors(context);
if (analysis.data?.hasErrors) {
  // Auto-fix errors
  const fix = await agentTools.autoFix(context);
}

// Run TypeScript check
const typeCheck = await agentTools.checkTypes(context);

// Run linter with auto-fix
await agentTools.lint(context, { fix: true });
```

### Chat API Integration

The chat API automatically:
1. Writes generated files to the project
2. Commits changes to git
3. Runs TypeScript type checking
4. Attempts auto-fix if errors are detected
5. Reports results back to the user

## UI Component

### SandboxTerminal

```tsx
import { SandboxTerminal } from '@/components/SandboxTerminal';

<SandboxTerminal 
  sessionId="abc123..."
  onError={(error) => console.log('Error:', error)}
/>
```

Features:
- Command input with history (up/down arrows)
- Tab completion for common commands
- Auto-fix button
- Suggested fix commands
- Color-coded output (success, error, info)
- Execution time display

## Security

### Command Whitelist
Only explicitly whitelisted command patterns are allowed. All other commands are rejected.

### Blocked Patterns
These patterns are always blocked:
- `rm -rf /` - Dangerous deletions
- `sudo` - Privilege escalation
- `eval`, `exec` - Code execution
- Piped remote execution (`wget|sh`, `curl|sh`)
- Path traversal (`../../`)

### Rate Limiting
- 30 commands per minute per user
- 10 auto-fix requests per minute per user

### Container Isolation
All commands run inside isolated Docker containers with:
- Limited CPU (0.5 cores default)
- Limited memory (512MB default)
- No host network access
- Read-only file mounts where appropriate

## Files

```
src/
├── lib/
│   ├── terminal-service.ts    # Core execution logic
│   ├── agent-tools.ts         # Agent integration tools
│   └── terminal/
│       └── index.ts           # Feature exports
├── components/
│   ├── SandboxTerminal.tsx    # Terminal UI component
│   └── DockerSandboxPreview.tsx # Updated with terminal tab
└── app/api/sandbox/[sessionId]/
    ├── exec/route.ts          # Command execution API
    └── autofix/route.ts       # Auto-fix API
```
