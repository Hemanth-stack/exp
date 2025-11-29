# GitHub Copilot Instructions for Enterprise AI Builder

## Project Overview
This is an enterprise-grade AI-powered no-code application builder. Users create full-stack applications through natural language prompts. The AI uses Anthropic Claude to understand requests and has access to file system, terminal, and git tools.

## Technology Stack
- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS + shadcn/ui components
- **Database**: PostgreSQL with Drizzle ORM
- **Cache**: Redis for sessions and caching
- **Auth**: NextAuth.js with credentials and OAuth
- **AI**: Anthropic Claude API (@anthropic-ai/sdk)
- **Containers**: Docker via dockerode
- **Git**: Simple-git for git operations

## Code Style Guidelines

### TypeScript
- Always use strict TypeScript with explicit types
- Prefer interfaces over types for object shapes
- Use Zod for runtime validation of API inputs
- Export types from dedicated type files
- Use `satisfies` for type checking object literals

### React/Next.js
- Use Server Components by default
- Only add "use client" when necessary (interactivity, hooks)
- Use Server Actions for mutations
- Implement proper loading.tsx and error.tsx
- Use React Suspense for async components
- Prefer named exports over default exports

### File Organization
- One component per file
- Co-locate related files (component + styles + tests)
- Use barrel exports (index.ts) for directories
- Keep files under 300 lines, split if larger

### Naming Conventions
- Components: PascalCase (ChatMessage.tsx)
- Hooks: camelCase with 'use' prefix (useChat.ts)
- Utils: camelCase (formatDate.ts)
- Types: PascalCase with 'T' or descriptive suffix (ProjectType, MessagePayload)
- Constants: SCREAMING_SNAKE_CASE

### API Routes
- Use route handlers in app/api
- Validate inputs with Zod schemas
- Return consistent response shapes: { data, error, message }
- Handle errors with try-catch and return appropriate status codes
- Use middleware for auth checks

### Database
- Use Drizzle ORM for all database operations
- Define schemas in src/lib/db/schema.ts
- Use transactions for multi-step operations
- Always use parameterized queries (Drizzle handles this)

### Error Handling
- Create custom error classes for domain errors
- Log errors with context (user, project, operation)
- Return user-friendly error messages
- Never expose stack traces in production

### Security Considerations
- Validate file paths to prevent directory traversal
- Whitelist allowed terminal commands
- Sanitize user inputs before shell execution
- Use parameterized queries (Drizzle)
- Rate limit API endpoints

## Common Patterns

### Creating a new API endpoint
```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth/config";

const inputSchema = z.object({
  // define shape
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const input = inputSchema.parse(body);
    
    // Business logic here
    
    return NextResponse.json({ data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    console.error("API Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

creating new tool 

import { z } from "zod";

export const myTool = {
  name: "my_tool",
  description: "Clear description of what this tool does",
  parameters: z.object({
    param1: z.string().describe("What this parameter is for"),
    param2: z.number().optional().describe("Optional parameter"),
  }),
  execute: async ({ param1, param2 }, context: ToolContext) => {
    // Validate permissions
    // Execute operation
    // Return result
    return { success: true, data: result };
  },
};

sever components with data fetching 

import { Suspense } from "react";
import { getProject } from "@/actions/projects";

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const project = await getProject(params.id);
  
  return (
    <div>
      <h1>{project.name}</h1>
      <Suspense fallback={<Loading />}>
        <ProjectDetails projectId={params.id} />
      </Suspense>
    </div>
  );
}

AI Agent Guidelines
When working on the AI agent system:

System prompts should be clear and specific
Tools should have comprehensive descriptions
Always validate tool inputs before execution
Log all tool executions for debugging
Handle tool errors gracefully
Implement token counting for cost tracking
Docker Guidelines
When working with Docker:

Always set resource limits on containers
Use health checks for all containers
Clean up stopped containers periodically
Never run containers as root
Mount project directories as volumes, not copies
Git Integration Guidelines
Auto-commit after AI makes significant changes
Use conventional commit messages
Keep commits atomic and focused
Never commit sensitive data (.env files)
Testing Approach
Unit tests for utility functions
Integration tests for API routes
E2E tests for critical user flows
Mock external services (Anthropic, Docker)