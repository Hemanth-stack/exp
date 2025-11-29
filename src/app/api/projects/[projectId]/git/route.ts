import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { GitManager } from '@/lib/git-manager';

const gitManager = new GitManager();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const commitSha = searchParams.get('commit');

    // Get project
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project || project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (!project.gitRepoPath) {
      return NextResponse.json({ error: 'Project repository not initialized' }, { status: 400 });
    }

    switch (action) {
      case 'log':
        const log = await gitManager.getLog(project.gitRepoPath, 50);
        return NextResponse.json({ commits: log });

      case 'status':
        const status = await gitManager.getStatus(project.gitRepoPath);
        return NextResponse.json({ status });

      case 'diff':
        const diff = await gitManager.getDiff(project.gitRepoPath, commitSha || undefined);
        return NextResponse.json({ diff });

      case 'branches':
        const branches = await gitManager.getBranches(project.gitRepoPath);
        return NextResponse.json({ branches });

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error in git operation:', error);
    return NextResponse.json({ error: 'Git operation failed' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const body = await request.json();
    const { action, message, commitSha, branch } = body;

    // Get project
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project || project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (!project.gitRepoPath) {
      return NextResponse.json({ error: 'Project repository not initialized' }, { status: 400 });
    }

    switch (action) {
      case 'commit':
        if (!message) {
          return NextResponse.json({ error: 'Commit message required' }, { status: 400 });
        }
        await gitManager.commit(project.gitRepoPath, message);
        return NextResponse.json({ success: true });

      case 'revert':
        if (!commitSha) {
          return NextResponse.json({ error: 'Commit SHA required' }, { status: 400 });
        }
        await gitManager.revertToCommit(project.gitRepoPath, commitSha);
        return NextResponse.json({ success: true });

      case 'checkout':
        if (!branch) {
          return NextResponse.json({ error: 'Branch name required' }, { status: 400 });
        }
        await gitManager.checkout(project.gitRepoPath, branch);
        return NextResponse.json({ success: true });

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error in git operation:', error);
    return NextResponse.json({ error: 'Git operation failed' }, { status: 500 });
  }
}
