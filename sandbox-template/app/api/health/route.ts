import { NextResponse } from 'next/server';

/**
 * Health check endpoint for container readiness
 * Polled by the main application to determine when the sandbox is ready
 */
export async function GET() {
  try {
    // Get basic system metrics
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime),
      memory: {
        rss: Math.floor(memoryUsage.rss / 1024 / 1024), // MB
        heapUsed: Math.floor(memoryUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.floor(memoryUsage.heapTotal / 1024 / 1024), // MB
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        sessionId: process.env.SESSION_ID || 'unknown',
      }
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
