/**
 * Project Preview Proxy Route
 * Proxies requests to project preview containers to avoid CO            </div>
          </body>
        </html>`,
        { status: 503, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Proxy the request to the container
    const previewHost = getPreviewHost();
    const targetUrl = `http://${previewHost}:${project.containerPort}${targetPath}`;nnection issues
 * This is used as an iframe source to prevent ERR_CONNECTION_REFUSED errors
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Get the host to use for connecting to preview containers
 * When running inside Docker, we need to use host.docker.internal to reach the host network
 */
function getPreviewHost(): string {
  // Use PREVIEW_INTERNAL_HOST if set (for Docker-in-Docker scenarios)
  if (process.env.PREVIEW_INTERNAL_HOST) {
    return process.env.PREVIEW_INTERNAL_HOST;
  }
  // In production (Docker), use host.docker.internal to reach the host
  if (process.env.NODE_ENV === 'production') {
    return 'host.docker.internal';
  }
  // In development, use localhost
  return 'localhost';
}

/**
 * GET /api/projects/[projectId]/preview/proxy?path=/
 * Serves content from the project preview container
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Unauthorized</title></head>
          <body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui;">
            <div style="text-align:center;">
              <h1>Unauthorized</h1>
              <p>Please log in to view previews</p>
            </div>
          </body>
        </html>`,
        { status: 401, headers: { 'Content-Type': 'text/html' } }
      );
    }

    const { projectId } = await params;
    const targetPath = request.nextUrl.searchParams.get('path') || '/';

    // Get project to verify ownership and get container port
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
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Not Found</title></head>
          <body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui;">
            <div style="text-align:center;">
              <h1>Project Not Found</h1>
              <p>The project does not exist or you don't have access</p>
            </div>
          </body>
        </html>`,
        { status: 404, headers: { 'Content-Type': 'text/html' } }
      );
    }

    if (!project.containerPort) {
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Preview Not Running</title></head>
          <body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui;background:#f5f5f5;">
            <div style="text-align:center;">
              <h2 style="color:#333;">Preview Not Running</h2>
              <p style="color:#666;">Start the preview to see your project</p>
            </div>
          </body>
        </html>`,
        { status: 503, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Proxy the request to the container
    const targetUrl = `http://${getPreviewHost()}:${project.containerPort}${targetPath}`;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      // Get content type and body
      const contentType = response.headers.get('content-type') || 'text/html';
      
      // For HTML content, rewrite URLs to go through our proxy
      if (contentType.includes('text/html')) {
        let html = await response.text();
        
        // Rewrite asset URLs to go through the proxy
        const baseProxyUrl = `/api/projects/${projectId}/preview/proxy?path=`;
        
        // Rewrite absolute paths (starting with /)
        html = html.replace(/(href|src)="\/([^"]*?)"/g, `$1="${baseProxyUrl}/$2"`);
        html = html.replace(/(href|src)='\/([^']*?)'/g, `$1='${baseProxyUrl}/$2'`);
        
        // Add base tag to handle relative URLs
        if (!html.includes('<base')) {
          html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseProxyUrl}/">`);
        }
        
        return new NextResponse(html, {
          status: response.status,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        });
      }
      
      // For other content types, pass through directly
      const body = await response.arrayBuffer();
      
      return new NextResponse(body, {
        status: response.status,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': contentType.includes('image') || contentType.includes('font') 
            ? 'public, max-age=31536000' 
            : 'no-cache',
        },
      });
    } catch (fetchError) {
      console.error('[Project Preview Proxy] Fetch error:', fetchError);
      
      // Check if it's a connection refused error
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed') || errorMessage.includes('aborted')) {
        return new NextResponse(
          `<!DOCTYPE html>
          <html>
            <head>
              <title>Loading Preview</title>
              <meta http-equiv="refresh" content="2">
            </head>
            <body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui;background:#f5f5f5;">
              <div style="text-align:center;">
                <div style="width:40px;height:40px;border:3px solid #e0e0e0;border-top-color:#3b82f6;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px;"></div>
                <h2 style="color:#333;margin:0 0 10px;">Server Starting</h2>
                <p style="color:#666;margin:0;">The development server is still initializing...</p>
              </div>
              <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
            </body>
          </html>`,
          { 
            status: 503, 
            headers: { 
              'Content-Type': 'text/html',
              'Retry-After': '2'
            } 
          }
        );
      }
      
      throw fetchError;
    }
  } catch (error) {
    console.error('[Project Preview Proxy] Error:', error);
    
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Error</title></head>
        <body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui;">
          <div style="text-align:center;">
            <h1 style="color:#dc2626;">Preview Error</h1>
            <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        </body>
      </html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }
}
