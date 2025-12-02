/**
 * Sandbox Proxy API Route
 * Proxies requests to sandbox containers to avoid CORS and connection issues
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { getSandboxInfo } from '@/lib/docker-service';

/**
 * GET /api/sandbox/proxy?sessionId=xxx&path=/
 * Proxy requests to the sandbox container
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const targetPath = request.nextUrl.searchParams.get('path') || '/';

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Missing sessionId parameter' },
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

    if (sandboxInfo.status !== 'healthy') {
      return NextResponse.json(
        { error: 'Sandbox not ready', status: sandboxInfo.status },
        { status: 503 }
      );
    }

    // Proxy the request to the container
    const targetUrl = `http://localhost:${sandboxInfo.port}${targetPath}`;
    
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    // Get the response body and content type
    const contentType = response.headers.get('content-type') || 'text/html';
    const body = await response.text();

    // Return proxied response
    return new NextResponse(body, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('[Sandbox Proxy] Error:', error);
    
    // Check if it's a connection refused error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
      return NextResponse.json(
        { error: 'Container not ready', retryable: true },
        { status: 503 }
      );
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * HEAD /api/sandbox/proxy?sessionId=xxx
 * Check if the sandbox is accessible (used for health checks)
 */
export async function HEAD(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    
    if (!sessionId) {
      return new NextResponse(null, { status: 400 });
    }

    // Get sandbox info
    const sandboxInfo = await getSandboxInfo(sessionId);
    if (!sandboxInfo) {
      return new NextResponse(null, { status: 404 });
    }

    if (sandboxInfo.status !== 'healthy') {
      return new NextResponse(null, { status: 503 });
    }

    // Try to reach the container
    try {
      const response = await fetch(`http://localhost:${sandboxInfo.port}/`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      
      return new NextResponse(null, { 
        status: response.ok ? 200 : 503,
        headers: {
          'X-Container-Status': 'ready',
        },
      });
    } catch {
      return new NextResponse(null, { 
        status: 503,
        headers: {
          'X-Container-Status': 'starting',
        },
      });
    }
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
