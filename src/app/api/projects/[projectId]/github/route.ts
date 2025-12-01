import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { projects, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createGitHubService } from '@/lib/github-service';
import { normalizeRepoPath, validateRepoPath } from '@/lib/git-manager';
import { checkRateLimit, createRateLimitHeaders, getRateLimitIdentifier, RATE_LIMITS } from '@/lib/rate-limit';

// Validate repository name format
function isValidRepoName(name: string): boolean {
  // GitHub repo names: alphanumeric, hyphens, underscores, max 100 chars
  const repoNameRegex = /^[a-zA-Z0-9._-]{1,100}$/;
  return repoNameRegex.test(name);
}

// Sanitize repository name
function sanitizeRepoName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limiting
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimitResult = checkRateLimit(identifier, RATE_LIMITS.github);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { 
          status: 429,
          headers: createRateLimitHeaders(rateLimitResult)
        }
      );
    }

    const { projectId } = await params;
    
    // Validate projectId format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    const body = await request.json();
    const { action } = body;

    // Validate action
    if (!action || !['push', 'sync'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Get user with GitHub credentials
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (!user?.githubAccessToken || !user?.githubUsername) {
      return NextResponse.json(
        { error: 'GitHub not connected. Please sign in with GitHub first.' },
        { status: 400 }
      );
    }

    // Get project
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project || project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (!project.gitRepoPath) {
      return NextResponse.json(
        { error: 'Project repository not initialized' },
        { status: 400 }
      );
    }

    // Normalize and validate the repo path
    const repoPath = normalizeRepoPath(project.gitRepoPath);
    
    // Validate path to prevent traversal attacks
    if (!validateRepoPath(repoPath)) {
      console.error(`[GitHub Route] Invalid repo path detected: ${repoPath}`);
      return NextResponse.json(
        { error: 'Invalid project path' },
        { status: 400 }
      );
    }

    const githubService = createGitHubService(user.githubAccessToken, user.githubUsername);

    switch (action) {
      case 'push': {
        // Sanitize and validate repository name
        let repoName = body.repoName;
        if (repoName) {
          repoName = sanitizeRepoName(repoName);
          if (!isValidRepoName(repoName)) {
            return NextResponse.json(
              { error: 'Invalid repository name' },
              { status: 400 }
            );
          }
        } else {
          repoName = sanitizeRepoName(`ai-app-${project.name}-${projectId.slice(0, 8)}`);
        }
        
        const repo = await githubService.pushLocalRepoToGitHub(
          repoPath,
          repoName,
          project.description || undefined
        );

        // Update project with GitHub repo info
        await db
          .update(projects)
          .set({
            githubRepoUrl: repo.html_url,
            githubRepoName: repo.name,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, projectId));

        return NextResponse.json({
          success: true,
          repo: {
            name: repo.name,
            url: repo.html_url,
            fullName: repo.full_name,
          },
        }, {
          headers: createRateLimitHeaders(rateLimitResult)
        });
      }

      case 'sync': {
        // Sync changes to GitHub
        if (!project.githubRepoName) {
          return NextResponse.json(
            { error: 'Project not connected to GitHub. Push first.' },
            { status: 400 }
          );
        }

        // Validate commit message if provided
        let commitMessage = body.commitMessage;
        if (commitMessage) {
          // Sanitize commit message - limit length and remove control characters
          commitMessage = commitMessage
            .slice(0, 500)
            .replace(/[\x00-\x1F\x7F]/g, '');
        }

        await githubService.syncToGitHub(
          repoPath,
          project.githubRepoName,
          commitMessage
        );

        return NextResponse.json({ success: true }, {
          headers: createRateLimitHeaders(rateLimitResult)
        });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('GitHub operation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'GitHub operation failed' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limiting
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimitResult = checkRateLimit(identifier, RATE_LIMITS.github);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { 
          status: 429,
          headers: createRateLimitHeaders(rateLimitResult)
        }
      );
    }

    const { projectId } = await params;

    // Validate projectId format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    // Get user with GitHub credentials
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    // Get project
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project || project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const isGithubConnected = !!(user?.githubAccessToken && user?.githubUsername);

    return NextResponse.json({
      isConnected: isGithubConnected,
      githubUsername: user?.githubUsername,
      repoUrl: project.githubRepoUrl,
      repoName: project.githubRepoName,
    }, {
      headers: createRateLimitHeaders(rateLimitResult)
    });
  } catch (error) {
    console.error('GitHub status error:', error);
    return NextResponse.json({ error: 'Failed to get GitHub status' }, { status: 500 });
  }
}
