import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { projects, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createGitHubService } from '@/lib/github-service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const body = await request.json();
    const { action } = body;

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

    const githubService = createGitHubService(user.githubAccessToken, user.githubUsername);

    switch (action) {
      case 'push': {
        // Push local repo to GitHub
        const repoName = body.repoName || `ai-app-${project.name.toLowerCase().replace(/\s+/g, '-')}-${projectId.slice(0, 8)}`;
        
        const repo = await githubService.pushLocalRepoToGitHub(
          project.gitRepoPath,
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

        await githubService.syncToGitHub(
          project.gitRepoPath,
          project.githubRepoName,
          body.commitMessage
        );

        return NextResponse.json({ success: true });
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

    const { projectId } = await params;

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
    });
  } catch (error) {
    console.error('GitHub status error:', error);
    return NextResponse.json({ error: 'Failed to get GitHub status' }, { status: 500 });
  }
}
