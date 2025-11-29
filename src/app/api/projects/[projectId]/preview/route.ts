import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { previewManager } from '@/lib/preview-manager';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;

    // Get project
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.userId, session.user.id)
        )
      )
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (!project.gitRepoPath) {
      return NextResponse.json({ error: 'Project repository not found' }, { status: 404 });
    }

    // Start preview
    const preview = await previewManager.startPreview(projectId, project.gitRepoPath);

    // Update project status
    await db
      .update(projects)
      .set({ 
        status: 'running',
        containerPort: preview.port 
      })
      .where(eq(projects.id, projectId));

    return NextResponse.json({
      success: true,
      preview: {
        url: `http://localhost:${preview.port}`,
        port: preview.port,
        status: preview.status,
      },
    });
  } catch (error: any) {
    console.error('Error starting preview:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to start preview' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;

    // Verify ownership
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.userId, session.user.id)
        )
      )
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Stop preview
    await previewManager.stopPreview(projectId);

    // Update project status
    await db
      .update(projects)
      .set({ status: 'created' })
      .where(eq(projects.id, projectId));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error stopping preview:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to stop preview' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;

    // Verify ownership
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.userId, session.user.id)
        )
      )
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const preview = previewManager.getPreview(projectId);
    
    if (!preview) {
      return NextResponse.json({ 
        status: 'stopped',
        url: null,
      });
    }

    const status = await previewManager.getPreviewStatus(projectId);

    return NextResponse.json({
      status,
      url: status === 'running' ? `http://localhost:${preview.port}` : null,
      port: preview.port,
    });
  } catch (error: any) {
    console.error('Error getting preview status:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get preview status' },
      { status: 500 }
    );
  }
}
