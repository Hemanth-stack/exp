import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { projects, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { gitManager, parseGitHubUrl, validateGitHubRepo } from '@/lib/git-manager';
import { createGitHubService } from '@/lib/github-service';
import { previewManager } from '@/lib/preview-manager';

// Schema for creating a project from template
const createFromTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  template: z.enum(['nextjs', 'vite-react']),
  source: z.literal('template').optional(),
});

// Schema for importing from GitHub
const importFromGitHubSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  githubUrl: z.string().url(),
  source: z.literal('github'),
  autoStartPreview: z.boolean().optional(),
});

// Combined schema
const createProjectSchema = z.discriminatedUnion('source', [
  createFromTemplateSchema.extend({ source: z.literal('template') }),
  importFromGitHubSchema,
]).or(createFromTemplateSchema); // Support legacy format without source field

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, session.user.id));

    return NextResponse.json(userProjects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
      return handleGitHubImport(parsed, session.user.id, user);
    }

    // Handle template-based creation (legacy and new format)
    const template = 'template' in parsed ? parsed.template : 'nextjs';
    return handleTemplateCreation(parsed, template, session.user.id, user);
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
  user: { githubAccessToken?: string | null } | null
) {
  const { name, description, githubUrl, autoStartPreview } = data;

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
  let detectedTemplate: string = 'nextjs';
  
  try {
    const result = await gitManager.cloneRepository(
      newProject.id,
      githubUrl,
      accessToken
    );
    repoPath = result.repoPath;
    detectedTemplate = result.detectedTemplate === 'unknown' ? 'nextjs' : result.detectedTemplate;

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

  // Optionally start preview after clone
  let preview = null;
  if (autoStartPreview && repoPath) {
    try {
      preview = await previewManager.startPreview(newProject.id, repoPath, userId);
      await db
        .update(projects)
        .set({ 
          status: 'running',
          containerPort: preview.port 
        })
        .where(eq(projects.id, newProject.id));
    } catch (error) {
      console.error('Error starting preview after clone:', error);
      // Don't fail - project was created successfully
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
    preview: preview ? {
      url: `http://localhost:${preview.port}`,
      port: preview.port,
      status: preview.status,
    } : null,
  }, { status: 201 });
}

/**
 * Handle project creation from a template
 */
async function handleTemplateCreation(
  data: { name: string; description?: string },
  template: string,
  userId: string,
  user: { githubAccessToken?: string | null; githubUsername?: string | null } | null
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
    await db
      .update(projects)
      .set({ gitRepoPath: repoPath })
      .where(eq(projects.id, newProject.id));
  } catch (error) {
    console.error('Error initializing git repository:', error);
  }

  // Auto-push to GitHub if user has GitHub connected
  try {
    if (user?.githubAccessToken && user?.githubUsername && repoPath) {
      const githubService = createGitHubService(user.githubAccessToken, user.githubUsername);
      const repoName = `ai-app-${name.toLowerCase().replace(/\s+/g, '-')}-${newProject.id.slice(0, 8)}`;
      
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

  return NextResponse.json(newProject, { status: 201 });
}
