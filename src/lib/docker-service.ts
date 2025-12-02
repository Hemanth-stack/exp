/**
 * Docker Service Utility
 * Manages Docker container lifecycle for isolated sandbox environments
 */

import Dockerode from 'dockerode';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

// Get preview host from environment or default to localhost
const getPreviewHost = () => process.env.PREVIEW_HOST || 'localhost';

// Initialize Dockerode client connecting to local Docker socket
const docker = new Dockerode({
  socketPath: process.platform === 'win32' 
    ? '//./pipe/docker_engine' 
    : '/var/run/docker.sock'
});

export interface SandboxConfig {
  sessionId: string;
  code: string;
  memory?: string;
  cpus?: string;
  port?: number;
}

export interface SandboxInfo {
  containerId: string;
  sessionId: string;
  port: number;
  previewUrl: string;
  status: 'creating' | 'starting' | 'healthy' | 'unhealthy' | 'stopped';
  createdAt: Date;
  lastAccessedAt: Date;
}

const SANDBOX_BASE_IMAGE = process.env.SANDBOX_BASE_IMAGE || 'nextjs-sandbox:latest';
const SANDBOX_NETWORK = 'sandbox-network';
const SANDBOX_DIR = path.join(process.cwd(), 'sandbox-instances');
const PORT_START = parseInt(process.env.DOCKER_CONTAINER_PORT_START || '3001');
const PORT_END = parseInt(process.env.DOCKER_CONTAINER_PORT_END || '4000');

// Store active sandboxes in memory (in production, use Redis)
const activeSandboxes = new Map<string, SandboxInfo>();

/**
 * Ensure sandbox directory exists
 */
async function ensureSandboxDir() {
  try {
    await fs.access(SANDBOX_DIR);
  } catch {
    await fs.mkdir(SANDBOX_DIR, { recursive: true });
  }
}

/**
 * Get all ports currently in use by Docker sandbox containers
 */
async function getDockerSandboxPorts(): Promise<Set<number>> {
  const usedPorts = new Set<number>();
  try {
    const containers = await docker.listContainers({ all: true });
    for (const container of containers) {
      // Only check sandbox containers
      const containerName = container.Names?.[0]?.replace('/', '') || '';
      if (containerName.startsWith('sandbox-')) {
        for (const port of container.Ports || []) {
          if (port.PublicPort) {
            usedPorts.add(port.PublicPort);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Docker Service] Error getting sandbox ports:', err);
  }
  return usedPorts;
}

/**
 * Sync in-memory state with actual Docker containers
 */
async function syncWithDocker(): Promise<void> {
  try {
    const containers = await docker.listContainers({ all: true });
    for (const containerInfo of containers) {
      const containerName = containerInfo.Names?.[0]?.replace('/', '') || '';
      if (containerName.startsWith('sandbox-')) {
        const sessionId = containerName.replace('sandbox-', '');
        
        // Find the port
        let port = 0;
        for (const p of containerInfo.Ports || []) {
          if (p.PublicPort) {
            port = p.PublicPort;
            break;
          }
        }
        
        if (port && !activeSandboxes.has(sessionId)) {
          // Restore sandbox info to in-memory state
          activeSandboxes.set(sessionId, {
            containerId: containerInfo.Id,
            sessionId,
            port,
            previewUrl: `http://${getPreviewHost()}:${port}`,
            status: containerInfo.State === 'running' ? 'healthy' : 'stopped',
            createdAt: new Date(containerInfo.Created * 1000),
            lastAccessedAt: new Date(),
          });
        }
      }
    }
  } catch (err) {
    console.error('[Docker Service] Error syncing with Docker:', err);
  }
}

/**
 * Find an available port for the sandbox
 * Checks both in-memory state AND actual Docker containers
 */
async function findAvailablePort(): Promise<number> {
  // Sync with Docker first
  await syncWithDocker();
  
  // Get ports from Docker
  const dockerPorts = await getDockerSandboxPorts();
  
  // Combine in-memory and Docker ports
  const usedPorts = new Set([
    ...Array.from(activeSandboxes.values()).map(s => s.port),
    ...dockerPorts
  ]);

  for (let port = PORT_START; port <= PORT_END; port++) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }

  throw new Error('No available ports for sandbox containers');
}

/**
 * Create sandbox directory structure with user code
 */
async function createSandboxFiles(sessionId: string, code: string): Promise<string> {
  await ensureSandboxDir();
  
  const sessionDir = path.join(SANDBOX_DIR, sessionId);
  const appDir = path.join(sessionDir, 'app');
  
  // Create directories
  await fs.mkdir(appDir, { recursive: true });
  
  // Write the user's component code to page.tsx
  const pagePath = path.join(appDir, 'page.tsx');
  await fs.writeFile(pagePath, code, 'utf-8');
  
  console.log(`[Docker Service] Created sandbox files for session ${sessionId}`);
  
  return sessionDir;
}

/**
 * Pull base image if not present
 */
async function ensureBaseImage(): Promise<void> {
  try {
    await docker.getImage(SANDBOX_BASE_IMAGE).inspect();
    console.log(`[Docker Service] Base image ${SANDBOX_BASE_IMAGE} is available`);
  } catch {
    console.log(`[Docker Service] Base image not found, building ${SANDBOX_BASE_IMAGE}...`);
    
    // Build the image from Dockerfile.sandbox
    const stream = await docker.buildImage(
      {
        context: process.cwd(),
        src: [
          'Dockerfile.sandbox',
          'sandbox-template',
        ]
      },
      {
        t: SANDBOX_BASE_IMAGE,
        dockerfile: 'Dockerfile.sandbox',
      }
    );

    // Wait for build to complete
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, (err, res) => 
        err ? reject(err) : resolve(res)
      );
    });

    console.log(`[Docker Service] Successfully built ${SANDBOX_BASE_IMAGE}`);
  }
}

/**
 * Ensure sandbox network exists
 */
async function ensureNetwork(): Promise<void> {
  try {
    await docker.getNetwork(SANDBOX_NETWORK).inspect();
  } catch {
    console.log(`[Docker Service] Creating network ${SANDBOX_NETWORK}`);
    await docker.createNetwork({
      Name: SANDBOX_NETWORK,
      Driver: 'bridge',
    });
  }
}

/**
 * Create and start a new sandbox container
 */
export async function createSandbox(config: SandboxConfig): Promise<SandboxInfo> {
  const { sessionId, code, memory = '512m', cpus = '0.5' } = config;
  
  console.log(`[Docker Service] Creating sandbox for session ${sessionId}`);
  
  // Ensure prerequisites
  await ensureBaseImage();
  await ensureNetwork();
  
  // Create sandbox files
  const sessionDir = await createSandboxFiles(sessionId, code);
  
  // Find available port
  const port = await findAvailablePort();
  
  // Container configuration
  const containerName = `sandbox-${sessionId}`;
  const hostAppDir = path.join(sessionDir, 'app');
  
  try {
    // Create container
    const container = await docker.createContainer({
      name: containerName,
      Image: SANDBOX_BASE_IMAGE,
      Env: [
        'NODE_ENV=development',
        `SESSION_ID=${sessionId}`,
        'PORT=3000',
        'HOSTNAME=0.0.0.0',
      ],
      HostConfig: {
        Memory: parseMemory(memory),
        NanoCpus: parseCpus(cpus),
        PortBindings: {
          '3000/tcp': [{ HostPort: port.toString() }]
        },
        Binds: [
          `${hostAppDir}:/app/app:ro`,
          '/app/node_modules',
          '/app/.next',
        ],
        NetworkMode: SANDBOX_NETWORK,
        RestartPolicy: {
          Name: 'unless-stopped',
        },
        AutoRemove: false,
      },
      ExposedPorts: {
        '3000/tcp': {}
      },
      Labels: {
        'sandbox.session': sessionId,
        'sandbox.created': new Date().toISOString(),
        'traefik.enable': 'true',
        [`traefik.http.routers.${containerName}.rule`]: `PathPrefix(\`/sandbox/${sessionId}\`)`,
        [`traefik.http.services.${containerName}.loadbalancer.server.port`]: '3000',
        [`traefik.http.middlewares.${containerName}-strip.stripprefix.prefixes`]: `/sandbox/${sessionId}`,
        [`traefik.http.routers.${containerName}.middlewares`]: `${containerName}-strip`,
      },
    });

    // Start the container
    await container.start();
    
    console.log(`[Docker Service] Started container ${containerName} on port ${port}`);
    
    // Create sandbox info
    const sandboxInfo: SandboxInfo = {
      containerId: container.id,
      sessionId,
      port,
      previewUrl: `http://${getPreviewHost()}:${port}`,
      status: 'starting',
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    };
    
    activeSandboxes.set(sessionId, sandboxInfo);
    
    // Wait for health check in background
    waitForHealthCheck(container, sessionId).catch(err => {
      console.error(`[Docker Service] Health check failed for ${sessionId}:`, err);
      sandboxInfo.status = 'unhealthy';
    });
    
    return sandboxInfo;
    
  } catch (error) {
    console.error(`[Docker Service] Failed to create sandbox ${sessionId}:`, error);
    
    // Cleanup on failure
    try {
      const container = docker.getContainer(containerName);
      await container.remove({ force: true });
    } catch {}
    
    throw new Error(`Failed to create sandbox: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Wait for container to be healthy
 */
async function waitForHealthCheck(container: Dockerode.Container, sessionId: string): Promise<void> {
  const maxAttempts = 30; // 30 attempts * 2s = 60s timeout
  const delayMs = 2000;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const info = await container.inspect();
      
      // Check if container is running
      if (!info.State.Running) {
        throw new Error('Container stopped unexpectedly');
      }
      
      // Check health status
      if (info.State.Health?.Status === 'healthy') {
        console.log(`[Docker Service] Sandbox ${sessionId} is healthy`);
        const sandboxInfo = activeSandboxes.get(sessionId);
        if (sandboxInfo) {
          sandboxInfo.status = 'healthy';
        }
        return;
      }
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
    } catch (error) {
      console.error(`[Docker Service] Health check error for ${sessionId}:`, error);
      throw error;
    }
  }
  
  throw new Error(`Health check timeout for sandbox ${sessionId}`);
}

/**
 * Stop and remove a sandbox container
 */
export async function destroySandbox(sessionId: string): Promise<void> {
  console.log(`[Docker Service] Destroying sandbox ${sessionId}`);
  
  const sandboxInfo = activeSandboxes.get(sessionId);
  if (!sandboxInfo) {
    throw new Error(`Sandbox ${sessionId} not found`);
  }
  
  try {
    const container = docker.getContainer(sandboxInfo.containerId);
    
    // Stop container gracefully with 10s timeout
    try {
      await container.stop({ t: 10 });
      console.log(`[Docker Service] Stopped container ${sessionId}`);
    } catch (error: unknown) {
      const dockerError = error as { statusCode?: number };
      if (dockerError.statusCode !== 304) { // 304 = already stopped
        throw error;
      }
    }
    
    // Remove container
    await container.remove({ v: true }); // v: true removes volumes
    console.log(`[Docker Service] Removed container ${sessionId}`);
    
    // Cleanup files
    const sessionDir = path.join(SANDBOX_DIR, sessionId);
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
      console.log(`[Docker Service] Cleaned up files for ${sessionId}`);
    } catch {
      console.warn(`[Docker Service] Failed to cleanup files for ${sessionId}`);
    }
    
    // Remove from active sandboxes
    activeSandboxes.delete(sessionId);
    
  } catch (error) {
    console.error(`[Docker Service] Failed to destroy sandbox ${sessionId}:`, error);
    throw error;
  }
}

/**
 * List all active sandbox containers
 */
export async function listActiveSandboxes(): Promise<SandboxInfo[]> {
  const sandboxes = Array.from(activeSandboxes.values());
  
  // Update status from Docker
  for (const sandbox of sandboxes) {
    try {
      const container = docker.getContainer(sandbox.containerId);
      const info = await container.inspect();
      
      if (!info.State.Running) {
        sandbox.status = 'stopped';
      } else if (info.State.Health?.Status === 'healthy') {
        sandbox.status = 'healthy';
      } else {
        sandbox.status = 'unhealthy';
      }
    } catch {
      sandbox.status = 'stopped';
    }
  }
  
  return sandboxes;
}

/**
 * Get sandbox info by session ID
 */
export async function getSandboxInfo(sessionId: string): Promise<SandboxInfo | null> {
  const sandbox = activeSandboxes.get(sessionId);
  if (!sandbox) {
    return null;
  }
  
  // Update status
  try {
    const container = docker.getContainer(sandbox.containerId);
    const info = await container.inspect();
    
    if (!info.State.Running) {
      sandbox.status = 'stopped';
    } else if (info.State.Health?.Status === 'healthy') {
      sandbox.status = 'healthy';
    }
  } catch {
    sandbox.status = 'stopped';
  }
  
  return sandbox;
}

/**
 * Cleanup idle sandboxes
 */
export async function cleanupIdleSandboxes(timeoutMinutes: number = 30): Promise<number> {
  console.log(`[Docker Service] Checking for idle sandboxes (timeout: ${timeoutMinutes}m)`);
  
  const now = new Date();
  const timeoutMs = timeoutMinutes * 60 * 1000;
  let cleanedCount = 0;
  
  for (const [sessionId, sandbox] of activeSandboxes.entries()) {
    const idleTime = now.getTime() - sandbox.lastAccessedAt.getTime();
    
    if (idleTime > timeoutMs) {
      console.log(`[Docker Service] Sandbox ${sessionId} idle for ${Math.floor(idleTime / 60000)}m, cleaning up`);
      try {
        await destroySandbox(sessionId);
        cleanedCount++;
      } catch (error) {
        console.error(`[Docker Service] Failed to cleanup ${sessionId}:`, error);
      }
    }
  }
  
  console.log(`[Docker Service] Cleaned up ${cleanedCount} idle sandbox(es)`);
  return cleanedCount;
}

/**
 * Update last accessed time for a sandbox
 */
export function touchSandbox(sessionId: string): void {
  const sandbox = activeSandboxes.get(sessionId);
  if (sandbox) {
    sandbox.lastAccessedAt = new Date();
  }
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Parse memory string to bytes
 */
function parseMemory(memory: string): number {
  const units: { [key: string]: number } = {
    'b': 1,
    'k': 1024,
    'm': 1024 * 1024,
    'g': 1024 * 1024 * 1024,
  };
  
  const match = memory.toLowerCase().match(/^(\d+)([bkmg])?$/);
  if (!match) {
    throw new Error(`Invalid memory format: ${memory}`);
  }
  
  const value = parseInt(match[1]);
  const unit = match[2] || 'b';
  
  return value * units[unit];
}

/**
 * Parse CPU string to nano CPUs
 */
function parseCpus(cpus: string): number {
  const value = parseFloat(cpus);
  if (isNaN(value) || value <= 0) {
    throw new Error(`Invalid CPU value: ${cpus}`);
  }
  
  return Math.floor(value * 1e9); // Convert to nano CPUs
}

/**
 * Check if Docker is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Docker info
 */
export async function getDockerInfo() {
  try {
    const info = await docker.info();
    return {
      available: true,
      containers: info.Containers,
      containersRunning: info.ContainersRunning,
      images: info.Images,
      serverVersion: info.ServerVersion,
      osType: info.OSType,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
