/**
 * Sandbox System Initializer
 * Initialize cleanup service and Docker system on app startup
 */

import { startCleanupService } from './sandbox-cleanup';
import { isDockerAvailable, getDockerInfo } from './docker-service';
import { validateEnvOrThrow } from './env-validation';

let initialized = false;

/**
 * Initialize the sandbox system
 * Call this in your Next.js app initialization
 */
export async function initializeSandboxSystem() {
  if (initialized) {
    console.log('[Sandbox System] Already initialized');
    return;
  }

  console.log('[Sandbox System] Initializing...');

  // Validate environment variables first
  try {
    validateEnvOrThrow();
  } catch (error) {
    console.error('[Sandbox System] Environment validation failed:', error);
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
  }

  // Check if Docker is enabled
  const dockerEnabled = process.env.DOCKER_ENABLED === 'true';
  if (!dockerEnabled) {
    console.log('[Sandbox System] Docker sandboxes are disabled (DOCKER_ENABLED=false)');
    return;
  }

  try {
    // Check Docker availability
    const available = await isDockerAvailable();
    if (!available) {
      console.warn('[Sandbox System] Docker is not available. Container previews will be disabled.');
      return;
    }

    // Get Docker info
    const info = await getDockerInfo();
    console.log('[Sandbox System] Docker is available:', {
      version: info.serverVersion,
      containers: info.containersRunning,
      osType: info.osType,
    });

    // Start cleanup service
    startCleanupService();

    initialized = true;
    console.log('[Sandbox System] Initialization complete');
  } catch (error) {
    console.error('[Sandbox System] Initialization failed:', error);
  }
}

/**
 * Check if sandbox system is initialized
 */
export function isSandboxSystemInitialized(): boolean {
  return initialized;
}
