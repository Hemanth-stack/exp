import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { previewManager } from '@/lib/preview-manager';
import { checkRateLimit, createRateLimitHeaders, getRateLimitIdentifier, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * GET /api/containers/stats
 * Get container usage statistics for the current user
 */
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

    const limitCheck = await previewManager.checkContainerLimit(session.user.id);
    const containers = await previewManager.getUserContainers(session.user.id);

    return NextResponse.json({
      userId: session.user.id,
      currentCount: limitCheck.current,
      maxAllowed: limitCheck.max,
      available: limitCheck.max - limitCheck.current,
      canStartNew: limitCheck.allowed,
      activeContainers: containers,
    }, {
      headers: createRateLimitHeaders(rateLimitResult)
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
export async function DELETE(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limiting (stricter for DELETE operations)
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimitResult = checkRateLimit(identifier, {
      ...RATE_LIMITS.api,
      maxRequests: 10, // Stricter limit for delete operations
    });
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { 
          status: 429,
          headers: createRateLimitHeaders(rateLimitResult)
        }
      );
    }

    const stoppedCount = await previewManager.stopAllUserContainers(session.user.id);

    return NextResponse.json({
      success: true,
      stoppedCount,
      message: `Stopped ${stoppedCount} container(s)`,
    }, {
      headers: createRateLimitHeaders(rateLimitResult)
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
