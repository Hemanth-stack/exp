/**
 * Sandbox Cleanup Service
 * Background process to cleanup idle and orphaned sandbox containers
 */

import { cleanupIdleSandboxes } from './docker-service';

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SANDBOX_TIMEOUT_MINUTES = parseInt(
  process.env.SANDBOX_TIMEOUT_MINUTES || '30'
);

let cleanupTimer: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Start the cleanup service
 */
export function startCleanupService() {
  if (isRunning) {
    console.log('[Cleanup Service] Already running');
    return;
  }

  console.log(
    `[Cleanup Service] Starting cleanup service (interval: ${CLEANUP_INTERVAL_MS / 1000}s, timeout: ${SANDBOX_TIMEOUT_MINUTES}m)`
  );

  isRunning = true;

  // Run cleanup immediately
  runCleanup();

  // Schedule periodic cleanup
  cleanupTimer = setInterval(() => {
    runCleanup();
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Stop the cleanup service
 */
export function stopCleanupService() {
  if (!isRunning) {
    return;
  }

  console.log('[Cleanup Service] Stopping cleanup service');

  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  isRunning = false;
}

/**
 * Run cleanup once
 */
async function runCleanup() {
  try {
    const timestamp = new Date().toISOString();
    console.log(`[Cleanup Service] Running cleanup at ${timestamp}`);

    const cleanedCount = await cleanupIdleSandboxes(SANDBOX_TIMEOUT_MINUTES);

    if (cleanedCount > 0) {
      console.log(
        `[Cleanup Service] Cleaned up ${cleanedCount} idle sandbox(es)`
      );
    }
  } catch (error) {
    console.error('[Cleanup Service] Cleanup failed:', error);
  }
}

/**
 * Check if cleanup service is running
 */
export function isCleanupServiceRunning(): boolean {
  return isRunning;
}

// Handle process termination
if (typeof process !== 'undefined') {
  process.on('SIGINT', () => {
    console.log('[Cleanup Service] Received SIGINT, stopping...');
    stopCleanupService();
  });

  process.on('SIGTERM', () => {
    console.log('[Cleanup Service] Received SIGTERM, stopping...');
    stopCleanupService();
  });
}
