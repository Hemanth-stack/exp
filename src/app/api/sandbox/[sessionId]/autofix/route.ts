/**
 * Auto-Fix API for Sandbox Containers
 * Automatically detects and resolves common errors
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { 
  executeCommand, 
  analyzeError,
  autoResolveError,
  getContainerLogs,
} from '@/lib/terminal-service';
import { getSandboxInfo } from '@/lib/docker-service';
import { checkRateLimit, createRateLimitHeaders, getRateLimitIdentifier } from '@/lib/rate-limit';

// Validate session ID format
function isValidSessionId(sessionId: string): boolean {
  return /^[a-f0-9]{32}$/i.test(sessionId);
}

/**
 * POST /api/sandbox/[sessionId]/autofix
 * Automatically detect and fix errors in a sandbox
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    // Verify authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in' },
        { status: 401 }
      );
    }

    const { sessionId } = await params;

    // Validate session ID
    if (!isValidSessionId(sessionId)) {
      return NextResponse.json(
        { error: 'Invalid session ID format' },
        { status: 400 }
      );
    }

    // Rate limiting
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimitResult = checkRateLimit(identifier, {
      maxRequests: 10,
      windowSeconds: 60,
      keyPrefix: 'autofix',
    });

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { 
          status: 429,
          headers: createRateLimitHeaders(rateLimitResult)
        }
      );
    }

    // Get sandbox info
    const sandboxInfo = await getSandboxInfo(sessionId);
    if (!sandboxInfo) {
      return NextResponse.json(
        { error: 'Sandbox not found' },
        { status: 404 }
      );
    }

    // Parse request body
    const body = await request.json().catch(() => ({}));
    const { error: providedError, maxAttempts = 3 } = body;

    // Get error from provided input or from container logs
    let errorToFix = providedError;
    
    if (!errorToFix) {
      // Get recent logs and look for errors
      const logs = await getContainerLogs(sandboxInfo.containerId, { tail: 200 });
      errorToFix = logs.stderr || logs.stdout;
    }

    if (!errorToFix) {
      return NextResponse.json({
        success: true,
        message: 'No errors detected',
        resolved: true,
        attempts: [],
      });
    }

    // Analyze the error first
    const suggestions = analyzeError(errorToFix);
    
    if (suggestions.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No automatic fix available for this error',
        error: errorToFix.slice(0, 500), // Truncate for response
        suggestions: [],
        resolved: false,
      });
    }

    console.log(`[AutoFix API] Attempting to fix error in sandbox ${sessionId}`);
    console.log(`[AutoFix API] Detected fixes:`, suggestions);

    // Attempt auto-resolution
    const result = await autoResolveError(sandboxInfo.containerId, errorToFix, {
      maxAttempts: Math.min(maxAttempts, 5), // Cap at 5 attempts
    });

    return NextResponse.json({
      success: result.resolved,
      message: result.resolved ? 'Error resolved successfully' : 'Could not automatically resolve error',
      resolved: result.resolved,
      attempts: result.attempts.map(a => ({
        command: a.command,
        success: a.result.success,
        output: a.result.stdout.slice(0, 1000),
        error: a.result.stderr.slice(0, 1000),
        executionTime: a.result.executionTime,
      })),
      suggestions: suggestions.map(s => ({
        command: s.command,
        description: s.description,
      })),
      finalError: result.finalError?.slice(0, 500),
    }, {
      headers: createRateLimitHeaders(rateLimitResult)
    });

  } catch (error) {
    console.error('[AutoFix API] Error:', error);
    return NextResponse.json(
      { error: 'Internal error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sandbox/[sessionId]/autofix
 * Analyze sandbox for errors without fixing
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    // Verify authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { sessionId } = await params;

    // Validate session ID
    if (!isValidSessionId(sessionId)) {
      return NextResponse.json(
        { error: 'Invalid session ID format' },
        { status: 400 }
      );
    }

    // Get sandbox info
    const sandboxInfo = await getSandboxInfo(sessionId);
    if (!sandboxInfo) {
      return NextResponse.json(
        { error: 'Sandbox not found' },
        { status: 404 }
      );
    }

    // Get recent logs
    const logs = await getContainerLogs(sandboxInfo.containerId, { tail: 200 });
    const errorOutput = logs.stderr || logs.stdout;

    // Analyze for errors
    const suggestions = analyzeError(errorOutput);

    // Also run a quick health check
    const healthCheck = await executeCommand(sandboxInfo.containerId, 'npm run build --dry-run 2>&1 || echo "Build check complete"', {
      timeout: 30000,
    });

    return NextResponse.json({
      sessionId,
      status: sandboxInfo.status,
      hasErrors: suggestions.length > 0,
      suggestions: suggestions.map(s => ({
        command: s.command,
        description: s.description,
        confidence: s.confidence,
      })),
      recentLogs: {
        stdout: logs.stdout.slice(-2000),
        stderr: logs.stderr.slice(-2000),
      },
      healthCheck: {
        success: healthCheck.success,
        output: healthCheck.stdout.slice(-1000),
      },
    });

  } catch (error) {
    console.error('[AutoFix API] Error:', error);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}
