/**
 * Project Terminal Execution API
 * Provides secure command execution inside project preview containers
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { 
  executeCommand, 
  isCommandAllowed, 
  analyzeError,
  autoResolveError,
  getContainerStats,
  getContainerLogs,
} from '@/lib/terminal-service';
import { previewManager } from '@/lib/preview-manager';
import { checkRateLimit, createRateLimitHeaders, getRateLimitIdentifier } from '@/lib/rate-limit';

/**
 * POST /api/projects/[projectId]/exec
 * Execute a command inside a project's preview container
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
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

    const { projectId } = await params;

    // Rate limiting
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimitResult = checkRateLimit(identifier, {
      maxRequests: 30,
      windowSeconds: 60,
      keyPrefix: 'project-terminal',
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

    // Get project and verify ownership
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
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Get container ID from preview manager
    const containerInfo = await previewManager.getPreview(projectId);
    if (!containerInfo || !containerInfo.containerId) {
      return NextResponse.json(
        { error: 'Container not running', message: 'Start the preview first to use terminal' },
        { status: 400 }
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

    // Check if command is allowed
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

    console.log(`[Project Terminal] Executing in project ${projectId}: ${command}`);

    // Execute the command
    const result = await executeCommand(containerInfo.containerId, command, {
      timeout: timeout || 60000,
      workDir: workDir || '/app',
    });

    // If command failed and autoFix is enabled, try to resolve
    let autoFixResult = null;
    if (!result.success && autoFix) {
      const errorOutput = result.stderr || result.stdout;
      const suggestions = analyzeError(errorOutput);
      
      if (suggestions.length > 0) {
        console.log(`[Project Terminal] Auto-fix suggestions:`, suggestions);
        
        autoFixResult = await autoResolveError(containerInfo.containerId, errorOutput, {
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
    console.error('[Project Terminal] Error:', error);
    return NextResponse.json(
      { error: 'Internal error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/projects/[projectId]/exec
 * Get container status, stats, and logs
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
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

    const { projectId } = await params;

    // Get project and verify ownership
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
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Get container ID from preview manager
    const containerInfo = await previewManager.getPreview(projectId);
    if (!containerInfo || !containerInfo.containerId) {
      return NextResponse.json({
        projectId,
        status: 'stopped',
        message: 'Container not running',
      });
    }

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action') || 'status';

    switch (action) {
      case 'status': {
        const stats = await getContainerStats(containerInfo.containerId);
        return NextResponse.json({
          projectId,
          containerId: containerInfo.containerId,
          status: containerInfo.status,
          port: containerInfo.port,
          stats,
        });
      }

      case 'logs': {
        const tail = parseInt(searchParams.get('tail') || '100');
        const logs = await getContainerLogs(containerInfo.containerId, { tail });
        return NextResponse.json({
          projectId,
          logs,
        });
      }

      case 'analyze': {
        // Get recent logs and analyze for errors
        const logs = await getContainerLogs(containerInfo.containerId, { tail: 200 });
        const errorOutput = logs.stderr || logs.stdout;
        const suggestions = analyzeError(errorOutput);
        
        return NextResponse.json({
          projectId,
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
    console.error('[Project Terminal] Error:', error);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}
