import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { projects, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';
import { gitManager, normalizeRepoPath } from '@/lib/git-manager';

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
    const filePath = searchParams.get('path');

    if (!filePath) {
      return NextResponse.json({ error: 'File path required' }, { status: 400 });
    }

    // Get user and verify project ownership
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

    // Normalize the repo path for Docker environment
    const repoPath = normalizeRepoPath(project.gitRepoPath);

    // Security: ensure path doesn't escape project directory
    const fullPath = path.join(repoPath, filePath);
    if (!fullPath.startsWith(repoPath)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    
    // Detect file language from extension
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.json': 'json',
      '.css': 'css',
      '.html': 'html',
      '.md': 'markdown',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.sh': 'bash',
      '.yml': 'yaml',
      '.yaml': 'yaml',
    };

    const language = languageMap[ext] || 'text';

    return NextResponse.json({ 
      content, 
      language,
      path: filePath 
    });
  } catch (error) {
    console.error('Error fetching file content:', error);
    return NextResponse.json({ error: 'Failed to fetch file content' }, { status: 500 });
  }
}

export async function PUT(
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
    const { path: filePath, content } = body;

    if (!filePath) {
      return NextResponse.json({ error: 'File path required' }, { status: 400 });
    }

    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'Content required' }, { status: 400 });
    }

    // Get user and verify project ownership
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

    // Normalize the repo path for Docker environment
    const repoPath = normalizeRepoPath(project.gitRepoPath);

    // Security: ensure path doesn't escape project directory
    const fullPath = path.join(repoPath, filePath);
    if (!fullPath.startsWith(repoPath)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    // Write the file
    await fs.writeFile(fullPath, content, 'utf-8');

    // Auto-commit and push the changes
    let syncResult = { committed: false, pushed: false };
    try {
      // Get user's GitHub token for push
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

      if (user?.githubAccessToken) {
        const commitMessage = `Updated file: ${filePath}`;
        
        // Pass the GitHub URL if available, or let the git manager use existing remote
        syncResult = await gitManager.commitAndPush(
          repoPath, 
          commitMessage,
          user.githubAccessToken,
          project.githubRepoUrl || undefined
        );
        
        if (syncResult.pushed) {
          console.log(`[Files API] Pushed changes to GitHub for project ${projectId}`);
        } else if (syncResult.committed) {
          console.log(`[Files API] Committed changes locally for project ${projectId} (push failed or no remote)`);
        }
      } else {
        // Just commit locally if no GitHub token
        await gitManager.commit(repoPath, `Updated file: ${filePath}`);
        syncResult.committed = true;
        console.log(`[Files API] Committed changes locally (no GitHub token)`);
      }
    } catch (commitErr) {
      console.error('Auto-commit/push error:', commitErr);
      // Don't fail the request if commit/push fails
    }

    return NextResponse.json({ 
      success: true,
      message: 'File saved successfully',
      path: filePath,
      gitSync: syncResult,
    });
  } catch (error) {
    console.error('Error saving file content:', error);
    return NextResponse.json({ error: 'Failed to save file content' }, { status: 500 });
  }
}
