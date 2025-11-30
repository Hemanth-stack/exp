/**
 * Sandbox API Route
 * Manages Docker-based sandbox containers for component previews
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import {
  createSandbox,
  destroySandbox,
  getSandboxInfo,
  generateSessionId,
  touchSandbox,
  isDockerAvailable,
} from '@/lib/docker-service';

/**
 * POST /api/sandbox
 * Create a new sandbox container
 */
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in to create sandboxes' },
        { status: 401 }
      );
    }

    // Check if Docker is available
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      return NextResponse.json(
        {
          error: 'Docker is not available',
          message: 'Docker Desktop must be running to use sandbox previews',
        },
        { status: 503 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { code, sessionId: existingSessionId } = body;

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request', message: 'Component code is required' },
        { status: 400 }
      );
    }

    // Generate or use existing session ID
    const sessionId = existingSessionId || generateSessionId();

    console.log(`[Sandbox API] Creating sandbox for session ${sessionId}`);

    // Get memory and CPU limits from env or use defaults
    const memory = process.env.SANDBOX_MAX_MEMORY || '512m';
    const cpus = process.env.SANDBOX_MAX_CPU || '0.5';

    // Create sandbox
    const sandboxInfo = await createSandbox({
      sessionId,
      code,
      memory,
      cpus,
    });

    return NextResponse.json({
      success: true,
      sessionId: sandboxInfo.sessionId,
      previewUrl: sandboxInfo.previewUrl,
      status: sandboxInfo.status,
      port: sandboxInfo.port,
      message: 'Sandbox container created successfully',
    }, { status: 201 });

  } catch (error) {
    console.error('[Sandbox API] Error creating sandbox:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to create sandbox',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sandbox?sessionId=xxx
 * Check sandbox status and get info
 */
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Invalid request', message: 'Session ID is required' },
        { status: 400 }
      );
    }

    // Get sandbox info
    const sandboxInfo = await getSandboxInfo(sessionId);

    if (!sandboxInfo) {
      return NextResponse.json(
        { error: 'Not found', message: 'Sandbox not found' },
        { status: 404 }
      );
    }

    // Update last accessed time
    touchSandbox(sessionId);

    return NextResponse.json({
      success: true,
      sessionId: sandboxInfo.sessionId,
      previewUrl: sandboxInfo.previewUrl,
      status: sandboxInfo.status,
      port: sandboxInfo.port,
      containerId: sandboxInfo.containerId,
      createdAt: sandboxInfo.createdAt,
      lastAccessedAt: sandboxInfo.lastAccessedAt,
    });

  } catch (error) {
    console.error('[Sandbox API] Error getting sandbox info:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to get sandbox info',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/sandbox?sessionId=xxx
 * Destroy a sandbox container
 */
export async function DELETE(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Invalid request', message: 'Session ID is required' },
        { status: 400 }
      );
    }

    console.log(`[Sandbox API] Destroying sandbox ${sessionId}`);

    // Destroy sandbox
    await destroySandbox(sessionId);

    return NextResponse.json({
      success: true,
      message: 'Sandbox destroyed successfully',
      sessionId,
    });

  } catch (error) {
    console.error('[Sandbox API] Error destroying sandbox:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to destroy sandbox',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
