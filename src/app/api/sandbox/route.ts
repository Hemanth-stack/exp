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
import { checkRateLimit, createRateLimitHeaders, getRateLimitIdentifier, RATE_LIMITS } from '@/lib/rate-limit';

// Validate session ID format (hex string, 32 characters)
function isValidSessionId(sessionId: string): boolean {
  return /^[a-f0-9]{32}$/i.test(sessionId);
}

// Basic code sanitization check
function isValidCode(code: string): { valid: boolean; error?: string } {
  // Check size limit (1MB max)
  const maxSize = 1024 * 1024;
  if (code.length > maxSize) {
    return { valid: false, error: 'Code exceeds maximum size limit (1MB)' };
  }
  
  // Check for potentially dangerous patterns (basic check)
  const dangerousPatterns = [
    /process\.env/i,
    /require\s*\(\s*['"]child_process/i,
    /require\s*\(\s*['"]fs['"]\s*\)/i,
    /eval\s*\(/i,
    /new\s+Function\s*\(/i,
  ];
  
  // Note: These are basic checks - the sandbox provides actual isolation
  // This is just a first line of defense
  for (const pattern of dangerousPatterns) {
    if (pattern.test(code)) {
      console.warn('[Sandbox API] Potentially dangerous pattern detected in code');
      // We log but don't block - sandbox provides isolation
    }
  }
  
  return { valid: true };
}

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

    // Rate limiting (stricter for sandbox creation - expensive operation)
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimitResult = checkRateLimit(identifier, {
      maxRequests: 10,
      windowSeconds: 60,
      keyPrefix: 'sandbox-create',
    });
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', message: 'Please wait before creating more sandboxes' },
        { 
          status: 429,
          headers: createRateLimitHeaders(rateLimitResult)
        }
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

    // Validate code
    const codeValidation = isValidCode(code);
    if (!codeValidation.valid) {
      return NextResponse.json(
        { error: 'Invalid code', message: codeValidation.error },
        { status: 400 }
      );
    }

    // Generate or use existing session ID
    let sessionId = existingSessionId;
    if (sessionId) {
      // Validate existing session ID format
      if (!isValidSessionId(sessionId)) {
        return NextResponse.json(
          { error: 'Invalid request', message: 'Invalid session ID format' },
          { status: 400 }
        );
      }
    } else {
      sessionId = generateSessionId();
    }

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
    }, { 
      status: 201,
      headers: createRateLimitHeaders(rateLimitResult)
    });

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

    // Rate limiting
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimitResult = checkRateLimit(identifier, RATE_LIMITS.api);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', message: 'Please try again later' },
        { 
          status: 429,
          headers: createRateLimitHeaders(rateLimitResult)
        }
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

    // Validate session ID format
    if (!isValidSessionId(sessionId)) {
      return NextResponse.json(
        { error: 'Invalid request', message: 'Invalid session ID format' },
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
    }, {
      headers: createRateLimitHeaders(rateLimitResult)
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

    // Rate limiting
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimitResult = checkRateLimit(identifier, RATE_LIMITS.api);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', message: 'Please try again later' },
        { 
          status: 429,
          headers: createRateLimitHeaders(rateLimitResult)
        }
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

    // Validate session ID format
    if (!isValidSessionId(sessionId)) {
      return NextResponse.json(
        { error: 'Invalid request', message: 'Invalid session ID format' },
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
    }, {
      headers: createRateLimitHeaders(rateLimitResult)
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
