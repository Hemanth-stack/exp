/**
 * Terminal Execution API
 * Provides secure command execution inside sandbox containers
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { 
  executeCommand, 
  isCommandAllowed, 
  analyzeError,
  autoResolveError,
  getContainerStats,
  getContainerLogs,
} from '@/lib/terminal-service';
import { getSandboxInfo } from '@/lib/docker-service';
import { checkRateLimit, createRateLimitHeaders, getRateLimitIdentifier } from '@/lib/rate-limit';

// Validate session ID format
function isValidSessionId(sessionId: string): boolean {
  return /^[a-f0-9]{32}$/i.test(sessionId);
}

/**
 * POST /api/sandbox/[sessionId]/exec
 * Execute a command inside a sandbox container
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

    // Rate limiting (10 commands per minute per user)
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimitResult = checkRateLimit(identifier, {
      maxRequests: 30,
      windowSeconds: 60,
      keyPrefix: 'terminal-exec',
    });

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', message: 'Please wait before running more commands' },
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
        { error: 'Sandbox not found', message: 'The sandbox session does not exist or has expired' },
        { status: 404 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { command, workDir, timeout, autoFix } = body;

    if (!command || typeof command !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request', message: 'Command is required' },
        { status: 400 }
      );
    }

    // Validate command length
    if (command.length > 1000) {
      return NextResponse.json(
        { error: 'Command too long', message: 'Maximum command length is 1000 characters' },
        { status: 400 }
      );
    }

    // Check if command is allowed (return early for UI feedback)
    const validation = isCommandAllowed(command);
    if (!validation.allowed) {
      return NextResponse.json({
        success: false,
        allowed: false,
        reason: validation.reason,
        result: {
          success: false,
          stdout: '',
          stderr: `Command not allowed: ${validation.reason}`,
          exitCode: -1,
          executionTime: 0,
        }
      });
    }

    console.log(`[Terminal API] Executing command in sandbox ${sessionId}: ${command}`);

    // Execute the command
    const result = await executeCommand(sandboxInfo.containerId, command, {
      timeout: timeout || 60000,
      workDir: workDir || '/app',
    });

    // If command failed and autoFix is enabled, try to resolve
    let autoFixResult = null;
    if (!result.success && autoFix) {
      const errorOutput = result.stderr || result.stdout;
      const suggestions = analyzeError(errorOutput);
      
      if (suggestions.length > 0) {
        console.log(`[Terminal API] Auto-fix suggestions:`, suggestions);
        
        autoFixResult = await autoResolveError(sandboxInfo.containerId, errorOutput, {
          maxAttempts: 2,
        });
      }
    }

    return NextResponse.json({
      success: result.success,
      allowed: true,
      result,
      autoFix: autoFixResult,
    }, {
      headers: createRateLimitHeaders(rateLimitResult)
    });

  } catch (error) {
    console.error('[Terminal API] Error:', error);
    return NextResponse.json(
      { error: 'Internal error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sandbox/[sessionId]/exec
 * Get container status, stats, and logs
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

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action') || 'status';

    switch (action) {
      case 'status': {
        const stats = await getContainerStats(sandboxInfo.containerId);
        return NextResponse.json({
          sessionId,
          status: sandboxInfo.status,
          previewUrl: sandboxInfo.previewUrl,
          stats,
        });
      }

      case 'logs': {
        const tail = parseInt(searchParams.get('tail') || '100');
        const logs = await getContainerLogs(sandboxInfo.containerId, { tail });
        return NextResponse.json({
          sessionId,
          logs,
        });
      }

      case 'analyze': {
        // Get recent logs and analyze for errors
        const logs = await getContainerLogs(sandboxInfo.containerId, { tail: 200 });
        const errorOutput = logs.stderr || logs.stdout;
        const suggestions = analyzeError(errorOutput);
        
        return NextResponse.json({
          sessionId,
          hasErrors: suggestions.length > 0,
          suggestions,
          recentLogs: logs,
        });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action', message: 'Valid actions: status, logs, analyze' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('[Terminal API] Error:', error);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}
