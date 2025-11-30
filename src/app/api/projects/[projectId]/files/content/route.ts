import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';
import { gitManager } from '@/lib/git-manager';

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

    // Security: ensure path doesn't escape project directory
    const fullPath = path.join(project.gitRepoPath, filePath);
    if (!fullPath.startsWith(project.gitRepoPath)) {
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

    // Security: ensure path doesn't escape project directory
    const fullPath = path.join(project.gitRepoPath, filePath);
    if (!fullPath.startsWith(project.gitRepoPath)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    // Write the file
    await fs.writeFile(fullPath, content, 'utf-8');

    // Auto-commit the changes
    try {
      const commitMessage = `Updated file: ${filePath}`;
      await gitManager.commit(project.gitRepoPath, commitMessage);
    } catch (commitErr) {
      console.error('Auto-commit error:', commitErr);
      // Don't fail the request if commit fails
    }

    return NextResponse.json({ 
      success: true,
      message: 'File saved successfully',
      path: filePath 
    });
  } catch (error) {
    console.error('Error saving file content:', error);
    return NextResponse.json({ error: 'Failed to save file content' }, { status: 500 });
  }
}
