/**
 * Docker Status API
 * Check Docker availability and get system information
 */

import { NextResponse } from 'next/server';
import { isDockerAvailable, getDockerInfo } from '@/lib/docker-service';

export async function GET() {
  try {
    const dockerInfo = await getDockerInfo();
    
    return NextResponse.json({
      ...dockerInfo,
      enabled: process.env.DOCKER_ENABLED === 'true',
    });
  } catch (error) {
    return NextResponse.json(
      {
        available: false,
        enabled: process.env.DOCKER_ENABLED === 'true',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
