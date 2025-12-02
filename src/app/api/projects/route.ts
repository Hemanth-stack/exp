import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { projects, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { gitManager, parseGitHubUrl, validateGitHubRepo, validateRepoPath } from '@/lib/git-manager';
import { createGitHubService } from '@/lib/github-service';
import { previewManager } from '@/lib/preview-manager';
import { checkRateLimit, createRateLimitHeaders, getRateLimitIdentifier, RATE_LIMITS, RateLimitResult } from '@/lib/rate-limit';

// Schema for creating a project from template
const createFromTemplateSchema = z.object({
  name: z.string().min(1).max(255).regex(/^[a-zA-Z0-9\s\-_]+$/, 'Project name can only contain letters, numbers, spaces, hyphens, and underscores'),
  description: z.string().max(1000).optional(),
  template: z.enum(['nextjs', 'vite-react']),
  source: z.literal('template').optional(),
});

// Schema for importing from GitHub
const importFromGitHubSchema = z.object({
  name: z.string().min(1).max(255).regex(/^[a-zA-Z0-9\s\-_]+$/, 'Project name can only contain letters, numbers, spaces, hyphens, and underscores'),
  description: z.string().max(1000).optional(),
  githubUrl: z.string().url().refine(
    (url) => url.startsWith('https://github.com/'),
    'Only GitHub URLs are supported'
  ),
  source: z.literal('github'),
  autoStartPreview: z.boolean().optional(),
});

// Combined schema
const createProjectSchema = z.discriminatedUnion('source', [
  createFromTemplateSchema.extend({ source: z.literal('template') }),
  importFromGitHubSchema,
]).or(createFromTemplateSchema); // Support legacy format without source field

export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limiting
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimitResult = checkRateLimit(identifier, RATE_LIMITS.api);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { 
          status: 429,
          headers: createRateLimitHeaders(rateLimitResult)
        }
      );
    }

    const userProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, session.user.id));

    return NextResponse.json(userProjects, {
      headers: createRateLimitHeaders(rateLimitResult)
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limiting (stricter for project creation)
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimitResult = checkRateLimit(identifier, {
      maxRequests: 10,
      windowSeconds: 60,
      keyPrefix: 'project-create',
    });
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before creating more projects.' },
        { 
          status: 429,
          headers: createRateLimitHeaders(rateLimitResult)
        }
      );
    }

    const body = await request.json();
    const parsed = createProjectSchema.parse(body);

    // Check project limit
    const userProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, session.user.id));

    if (userProjects.length >= session.user.maxProjects) {
      return NextResponse.json(
        { error: 'Project limit reached' },
        { status: 403 }
      );
    }

    // Get user info for GitHub operations
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    // Handle GitHub import
    if ('source' in parsed && parsed.source === 'github') {
      return handleGitHubImport(parsed, session.user.id, user, rateLimitResult);
    }

    // Handle template-based creation (legacy and new format)
    const template = 'template' in parsed ? parsed.template : 'nextjs';
    return handleTemplateCreation(parsed, template, session.user.id, user, rateLimitResult);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error creating project:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Handle project creation from a GitHub URL
 */
async function handleGitHubImport(
  data: { name: string; description?: string; githubUrl: string; autoStartPreview?: boolean },
  userId: string,
  user: { githubAccessToken?: string | null } | null,
  rateLimitResult: RateLimitResult
) {
  const { name, description, githubUrl, autoStartPreview = true } = data;

  // Validate the GitHub URL
  const parsed = parseGitHubUrl(githubUrl);
  if (!parsed.isValid) {
    return NextResponse.json(
      { error: 'Invalid GitHub URL format' },
      { status: 400 }
    );
  }

  // Validate repository exists and is accessible
  const accessToken = user?.githubAccessToken || undefined;
  const validation = await validateGitHubRepo(githubUrl, accessToken);
  
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error || 'Repository not accessible' },
      { status: 400 }
    );
  }

  // Create project record
  const [newProject] = await db
    .insert(projects)
    .values({
      userId,
      name,
      description: description || validation.repoInfo?.description || '',
      template: 'nextjs', // Will be updated after clone
      status: 'cloning',
      githubRepoUrl: githubUrl,
      githubRepoName: `${parsed.owner}/${parsed.repo}`,
    })
    .returning();

  // Clone the repository
  let repoPath: string | null = null;
  let detectedTemplate: string = 'unknown';
  
  try {
    const result = await gitManager.cloneRepository(
      newProject.id,
      githubUrl,
      accessToken
    );
    repoPath = result.repoPath;
    detectedTemplate = result.detectedTemplate;

    // Validate repo path to prevent path traversal
    if (!validateRepoPath(repoPath)) {
      console.error(`[Projects API] Invalid repo path: ${repoPath}`);
      throw new Error('Invalid repository path');
    }

    // Update project with repo path and detected template
    await db
      .update(projects)
      .set({
        gitRepoPath: repoPath,
        template: detectedTemplate,
        status: 'created',
      })
      .where(eq(projects.id, newProject.id));

    console.log(`[Projects API] Cloned GitHub repo to ${repoPath}, detected: ${detectedTemplate}`);
  } catch (error: unknown) {
    console.error('Error cloning repository:', error);
    
    // Update project status to error
    await db
      .update(projects)
      .set({ status: 'error' })
      .where(eq(projects.id, newProject.id));

    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to clone repository: ${message}` },
      { status: 500 }
    );
  }

  // Check if preview is supported for this project type
  const supportedTypes = [
    'nextjs', 'vite-react', 'vue', 'angular', 'svelte', 'express', 'node', 'react',
    'python', 'flask', 'django', 'fastapi', 'streamlit',
    'java', 'static'
  ];
  const isPreviewSupported = supportedTypes.some(t => 
    detectedTemplate.toLowerCase().includes(t.toLowerCase())
  ) || detectedTemplate !== 'unknown';
  
  // Start preview after clone (default: true)
  let preview = null;
  if (autoStartPreview && repoPath && isPreviewSupported) {
    try {
      console.log(`[Projects API] Starting preview for ${newProject.id}...`);
      preview = await previewManager.startPreview(newProject.id, repoPath, userId);
      await db
        .update(projects)
        .set({ 
          status: 'running',
          containerPort: preview.port 
        })
        .where(eq(projects.id, newProject.id));
      console.log(`[Projects API] Preview started on port ${preview.port}`);
    } catch (error) {
      console.error('Error starting preview after clone:', error);
      // Don't fail - project was created successfully, update status
      await db
        .update(projects)
        .set({ status: 'created' })
        .where(eq(projects.id, newProject.id));
    }
  }

  // Get updated project
  const [updatedProject] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, newProject.id))
    .limit(1);

  return NextResponse.json({
    ...updatedProject,
    detectedType: detectedTemplate,
    isPreviewSupported,
    preview: preview ? {
      url: `http://${process.env.PREVIEW_HOST || 'localhost'}:${preview.port}`,
      port: preview.port,
      status: preview.status,
    } : null,
  }, { 
    status: 201,
    headers: createRateLimitHeaders(rateLimitResult)
  });
}

/**
 * Handle project creation from a template
 */
async function handleTemplateCreation(
  data: { name: string; description?: string },
  template: string,
  userId: string,
  user: { githubAccessToken?: string | null; githubUsername?: string | null } | null,
  rateLimitResult: RateLimitResult
) {
  const { name, description } = data;

  // Create new project
  const [newProject] = await db
    .insert(projects)
    .values({
      userId,
      name,
      description,
      template,
      status: 'created',
    })
    .returning();

  // Initialize git repository
  let repoPath: string | null = null;
  try {
    repoPath = await gitManager.initRepository(newProject.id, template);
    console.log(`[Projects API] Initialized repo at: ${repoPath}`);
    
    // Validate repo path
    if (repoPath && !validateRepoPath(repoPath)) {
      console.error(`[Projects API] Invalid repo path: ${repoPath}`);
      throw new Error('Invalid repository path');
    }
    
    await db
      .update(projects)
      .set({ gitRepoPath: repoPath })
      .where(eq(projects.id, newProject.id));
    
    console.log(`[Projects API] Updated project ${newProject.id} with gitRepoPath: ${repoPath}`);
  } catch (error) {
    console.error('Error initializing git repository:', error);
    // Still continue - project is created but without local files
  }

  // Auto-push to GitHub if user has GitHub connected
  try {
    if (user?.githubAccessToken && user?.githubUsername && repoPath) {
      const githubService = createGitHubService(user.githubAccessToken, user.githubUsername);
      const repoName = `ai-app-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50)}-${newProject.id.slice(0, 8)}`;
      
      const repo = await githubService.pushLocalRepoToGitHub(
        repoPath,
        repoName,
        description
      );

      await db
        .update(projects)
        .set({
          githubRepoUrl: repo.html_url,
          githubRepoName: repo.name,
        })
        .where(eq(projects.id, newProject.id));

      console.log(`Auto-pushed project to GitHub: ${repo.html_url}`);
    }
  } catch (error) {
    console.error('Error auto-pushing to GitHub:', error);
    // Don't fail the project creation if GitHub push fails
  }

  // Fetch the updated project with gitRepoPath
  const [updatedProject] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, newProject.id))
    .limit(1);

  return NextResponse.json(updatedProject || newProject, { 
    status: 201,
    headers: createRateLimitHeaders(rateLimitResult)
  });
}
