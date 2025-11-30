import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { previewManager } from '@/lib/preview-manager';

/**
 * GET /api/containers/stats
 * Get container usage statistics for the current user
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limitCheck = await previewManager.checkContainerLimit(session.user.id);
    const containers = await previewManager.getUserContainers(session.user.id);

    return NextResponse.json({
      userId: session.user.id,
      currentCount: limitCheck.current,
      maxAllowed: limitCheck.max,
      available: limitCheck.max - limitCheck.current,
      canStartNew: limitCheck.allowed,
      activeContainers: containers,
    });
  } catch (error: unknown) {
    console.error('Error getting container stats:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get container stats';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/containers/stats
 * Stop all containers for the current user
 */
export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const stoppedCount = await previewManager.stopAllUserContainers(session.user.id);

    return NextResponse.json({
      success: true,
      stoppedCount,
      message: `Stopped ${stoppedCount} container(s)`,
    });
  } catch (error: unknown) {
    console.error('Error stopping all containers:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to stop containers';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
