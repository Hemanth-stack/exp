/**
 * Preview Manager with Redis State Management
 * Manages Docker preview containers with multi-user support and container limits
 */

import Docker from 'dockerode';
import path from 'path';
import fs from 'fs/promises';
import { getRedisClient, REDIS_KEYS, CONTAINER_LIMITS } from './redis';

const docker = new Docker();

export interface PreviewContainer {
  containerId: string;
  port: number;
  projectId: string;
  userId: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  createdAt: string;
  lastAccessedAt: string;
}

export interface ContainerLimitError extends Error {
  code: 'CONTAINER_LIMIT_EXCEEDED';
  currentCount: number;
  maxAllowed: number;
}

class PreviewManager {
  private portStart = 4001;
  private portEnd = 5000;

  /**
   * Get container info from Redis
   */
  private async getContainerFromRedis(projectId: string): Promise<PreviewContainer | null> {
    try {
      const redis = await getRedisClient();
      const data = await redis.get(REDIS_KEYS.PREVIEW_CONTAINER(projectId));
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error('[PreviewManager] Error getting container from Redis:', err);
      return null;
    }
  }

  /**
   * Save container info to Redis
   */
  private async saveContainerToRedis(container: PreviewContainer): Promise<void> {
    try {
      const redis = await getRedisClient();
      const key = REDIS_KEYS.PREVIEW_CONTAINER(container.projectId);
      
      // Save container data with TTL (auto-expire after timeout)
      const ttl = CONTAINER_LIMITS.CONTAINER_TIMEOUT_MINUTES * 60;
      await redis.setEx(key, ttl, JSON.stringify(container));
      
      // Add to user's container set
      await redis.sAdd(REDIS_KEYS.USER_CONTAINERS(container.userId), container.projectId);
      
      // Add port to used ports set
      await redis.sAdd(REDIS_KEYS.USED_PORTS, container.port.toString());
      
      console.log(`[PreviewManager] Saved container ${container.projectId} to Redis`);
    } catch (err) {
      console.error('[PreviewManager] Error saving container to Redis:', err);
    }
  }

  /**
   * Remove container info from Redis
   */
  private async removeContainerFromRedis(projectId: string, userId?: string, port?: number): Promise<void> {
    try {
      const redis = await getRedisClient();
      
      // Get container info if not provided
      if (!userId || !port) {
        const container = await this.getContainerFromRedis(projectId);
        if (container) {
          userId = container.userId;
          port = container.port;
        }
      }
      
      // Remove container data
      await redis.del(REDIS_KEYS.PREVIEW_CONTAINER(projectId));
      
      // Remove from user's container set
      if (userId) {
        await redis.sRem(REDIS_KEYS.USER_CONTAINERS(userId), projectId);
      }
      
      // Remove port from used ports set
      if (port) {
        await redis.sRem(REDIS_KEYS.USED_PORTS, port.toString());
      }
      
      console.log(`[PreviewManager] Removed container ${projectId} from Redis`);
    } catch (err) {
      console.error('[PreviewManager] Error removing container from Redis:', err);
    }
  }

  /**
   * Get count of user's active containers
   */
  async getUserContainerCount(userId: string): Promise<number> {
    try {
      const redis = await getRedisClient();
      return await redis.sCard(REDIS_KEYS.USER_CONTAINERS(userId));
    } catch (err) {
      console.error('[PreviewManager] Error getting user container count:', err);
      return 0;
    }
  }

  /**
   * Get all container IDs for a user
   */
  async getUserContainers(userId: string): Promise<string[]> {
    try {
      const redis = await getRedisClient();
      return await redis.sMembers(REDIS_KEYS.USER_CONTAINERS(userId));
    } catch (err) {
      console.error('[PreviewManager] Error getting user containers:', err);
      return [];
    }
  }

  /**
   * Check if user has reached container limit
   */
  async checkContainerLimit(userId: string): Promise<{ allowed: boolean; current: number; max: number }> {
    const current = await this.getUserContainerCount(userId);
    const max = CONTAINER_LIMITS.MAX_CONTAINERS_PER_USER;
    return {
      allowed: current < max,
      current,
      max,
    };
  }

  /**
   * Get all ports currently in use from Redis and Docker
   */
  private async getUsedPorts(): Promise<Set<number>> {
    const usedPorts = new Set<number>();
    
    try {
      // Get from Redis
      const redis = await getRedisClient();
      const redisPorts = await redis.sMembers(REDIS_KEYS.USED_PORTS);
      redisPorts.forEach(p => usedPorts.add(parseInt(p)));
    } catch (err) {
      console.error('[PreviewManager] Error getting ports from Redis:', err);
    }
    
    // Also check actual Docker containers
    try {
      const containers = await docker.listContainers({ all: true });
      for (const container of containers) {
        const containerName = container.Names?.[0]?.replace('/', '') || '';
        if (containerName.startsWith('preview-')) {
          for (const port of container.Ports || []) {
            if (port.PublicPort) {
              usedPorts.add(port.PublicPort);
            }
          }
        }
      }
    } catch (err) {
      console.error('[PreviewManager] Error getting ports from Docker:', err);
    }
    
    return usedPorts;
  }

  /**
   * Find an available port
   */
  private async findAvailablePort(): Promise<number> {
    const usedPorts = await this.getUsedPorts();

    for (let port = this.portStart; port <= this.portEnd; port++) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }
    throw new Error('No available ports for preview');
  }

  /**
   * Sync Redis state with actual Docker containers
   */
  async syncWithDocker(): Promise<void> {
    try {
      const redis = await getRedisClient();
      const containers = await docker.listContainers({ all: true });
      
      // Get all preview containers from Docker
      const dockerContainers = new Map<string, { containerId: string; port: number; running: boolean }>();
      
      for (const containerInfo of containers) {
        const containerName = containerInfo.Names?.[0]?.replace('/', '') || '';
        if (containerName.startsWith('preview-')) {
          const projectId = containerName.replace('preview-', '');
          let port = 0;
          for (const p of containerInfo.Ports || []) {
            if (p.PublicPort) {
              port = p.PublicPort;
              break;
            }
          }
          dockerContainers.set(projectId, {
            containerId: containerInfo.Id,
            port,
            running: containerInfo.State === 'running',
          });
        }
      }
      
      // Check Redis entries against Docker
      const usedPorts = await redis.sMembers(REDIS_KEYS.USED_PORTS);
      for (const portStr of usedPorts) {
        const port = parseInt(portStr);
        let found = false;
        for (const [, info] of dockerContainers) {
          if (info.port === port) {
            found = true;
            break;
          }
        }
        if (!found) {
          // Port in Redis but container doesn't exist - clean up
          await redis.sRem(REDIS_KEYS.USED_PORTS, portStr);
        }
      }
      
      console.log(`[PreviewManager] Synced with Docker: ${dockerContainers.size} preview containers`);
    } catch (err) {
      console.error('[PreviewManager] Error syncing with Docker:', err);
    }
  }

  /**
   * Clean up existing container for a project
   */
  private async cleanupExistingProjectContainer(projectId: string): Promise<void> {
    const containerName = `preview-${projectId}`;
    try {
      const container = docker.getContainer(containerName);
      const info = await container.inspect();
      console.log(`[PreviewManager] Found existing container ${containerName}, removing...`);
      
      // Get info before removing
      const oldPort = info.NetworkSettings?.Ports?.['3000/tcp']?.[0]?.HostPort;
      
      if (info.State.Running) {
        await container.stop();
      }
      await container.remove();
      
      // Clean up Redis state
      await this.removeContainerFromRedis(projectId, undefined, oldPort ? parseInt(oldPort) : undefined);
    } catch (err: unknown) {
      const dockerErr = err as { statusCode?: number };
      if (dockerErr.statusCode !== 404) {
        console.error('[PreviewManager] Error cleaning up old container:', err);
      }
    }
  }

  /**
   * Start a preview container for a project
   */
  async startPreview(projectId: string, repoPath: string, userId: string): Promise<PreviewContainer> {
    // Check container limit for user
    const limitCheck = await this.checkContainerLimit(userId);
    
    // Check if this project already has a container (doesn't count against limit)
    const existing = await this.getContainerFromRedis(projectId);
    if (existing) {
      // Verify it's actually running in Docker
      try {
        const container = docker.getContainer(existing.containerId);
        const info = await container.inspect();
        if (info.State.Running) {
          // Update last accessed time
          existing.lastAccessedAt = new Date().toISOString();
          existing.status = 'running';
          await this.saveContainerToRedis(existing);
          return existing;
        }
      } catch {
        // Container doesn't exist anymore, clean up Redis state
        await this.removeContainerFromRedis(projectId, existing.userId, existing.port);
      }
    }
    
    // If no existing container and limit reached, throw error
    if (!existing && !limitCheck.allowed) {
      const error = new Error(
        `Container limit reached. You have ${limitCheck.current}/${limitCheck.max} containers running. ` +
        `Please stop some containers before starting new ones.`
      ) as ContainerLimitError;
      error.code = 'CONTAINER_LIMIT_EXCEEDED';
      error.currentCount = limitCheck.current;
      error.maxAllowed = limitCheck.max;
      throw error;
    }

    // Clean up any existing container for this project
    await this.cleanupExistingProjectContainer(projectId);

    const port = await this.findAvailablePort();
    
    try {
      // Check if package.json exists
      const packagePath = path.join(repoPath, 'package.json');
      await fs.access(packagePath);
      const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf-8'));

      // Determine if this is a Next.js project
      const isNextJs = packageJson.dependencies?.next || packageJson.devDependencies?.next;
      
      // Use our sandbox image for Next.js projects
      const imageName = isNextJs ? 'nextjs-sandbox:latest' : 'node:18-alpine';
      const devCommand = packageJson.scripts?.dev || 'npm run dev';
      
      // Create container
      const container = await docker.createContainer({
        Image: imageName,
        name: `preview-${projectId}`,
        WorkingDir: '/app',
        Cmd: isNextJs 
          ? undefined
          : ['sh', '-c', `npm install && ${devCommand}`],
        ExposedPorts: {
          '3000/tcp': {},
        },
        HostConfig: {
          PortBindings: {
            '3000/tcp': [{ HostPort: port.toString() }],
          },
          Binds: [`${repoPath}:/app/user-project`],
          AutoRemove: false,
        },
        Env: [
          'NODE_ENV=development',
          'PORT=3000',
          'HOSTNAME=0.0.0.0',
        ],
        Labels: {
          'preview.projectId': projectId,
          'preview.userId': userId,
          'preview.createdAt': new Date().toISOString(),
        },
      });

      await container.start();

      const now = new Date().toISOString();
      const previewContainer: PreviewContainer = {
        containerId: container.id,
        port,
        projectId,
        userId,
        status: 'starting',
        createdAt: now,
        lastAccessedAt: now,
      };

      // Save to Redis
      await this.saveContainerToRedis(previewContainer);

      // Start background check for container readiness
      const startupTime = isNextJs ? 30000 : 8000;
      this.waitForContainerReady(projectId, container.id, port, startupTime);

      return previewContainer;
    } catch (error) {
      // Clean up on failure
      try {
        const redis = await getRedisClient();
        await redis.sRem(REDIS_KEYS.USED_PORTS, port.toString());
      } catch {
        // Ignore Redis errors during cleanup
      }
      throw error;
    }
  }

  /**
   * Wait for container to be ready and update status
   */
  private async waitForContainerReady(
    projectId: string, 
    containerId: string, 
    port: number,
    maxWaitTime: number
  ): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 2000;
    
    const check = async () => {
      try {
        const container = docker.getContainer(containerId);
        const info = await container.inspect();
        
        if (!info.State.Running) {
          await this.updateContainerStatus(projectId, 'error');
          console.error(`[PreviewManager] Container ${containerId} stopped unexpectedly`);
          return;
        }

        try {
          const response = await fetch(`http://localhost:${port}`, {
            signal: AbortSignal.timeout(1000)
          });
          
          if (response.ok || response.status === 404) {
            await this.updateContainerStatus(projectId, 'running');
            console.log(`[PreviewManager] Preview container ${projectId} is now ready on port ${port}`);
            return;
          }
        } catch {
          // Server not ready yet
        }

        if (Date.now() - startTime < maxWaitTime) {
          setTimeout(check, checkInterval);
        } else {
          await this.updateContainerStatus(projectId, 'running');
          console.log(`[PreviewManager] Preview container ${projectId} marked as running after timeout`);
        }
      } catch (error) {
        console.error('[PreviewManager] Error checking container readiness:', error);
        await this.updateContainerStatus(projectId, 'error');
      }
    };

    setTimeout(check, checkInterval);
  }

  /**
   * Update container status in Redis
   */
  private async updateContainerStatus(projectId: string, status: PreviewContainer['status']): Promise<void> {
    try {
      const container = await this.getContainerFromRedis(projectId);
      if (container) {
        container.status = status;
        container.lastAccessedAt = new Date().toISOString();
        await this.saveContainerToRedis(container);
      }
    } catch (err) {
      console.error('[PreviewManager] Error updating container status:', err);
    }
  }

  /**
   * Stop a preview container
   */
  async stopPreview(projectId: string): Promise<void> {
    const containerInfo = await this.getContainerFromRedis(projectId);
    
    try {
      const containerName = `preview-${projectId}`;
      const container = docker.getContainer(containerName);
      
      try {
        await container.stop();
      } catch (err: unknown) {
        const dockerErr = err as { statusCode?: number };
        if (dockerErr.statusCode !== 304) { // 304 = already stopped
          throw err;
        }
      }
      
      await container.remove();
    } catch (err: unknown) {
      const dockerErr = err as { statusCode?: number };
      if (dockerErr.statusCode !== 404) {
        console.error('[PreviewManager] Error stopping preview:', err);
      }
    }
    
    // Clean up Redis state
    await this.removeContainerFromRedis(
      projectId, 
      containerInfo?.userId, 
      containerInfo?.port
    );
  }

  /**
   * Get preview container info
   */
  async getPreview(projectId: string): Promise<PreviewContainer | null> {
    const container = await this.getContainerFromRedis(projectId);
    
    if (container) {
      // Update last accessed time
      container.lastAccessedAt = new Date().toISOString();
      await this.saveContainerToRedis(container);
    }
    
    return container;
  }

  /**
   * Get preview status
   */
  async getPreviewStatus(projectId: string): Promise<string> {
    const containerInfo = await this.getContainerFromRedis(projectId);
    if (!containerInfo) return 'stopped';

    try {
      const container = docker.getContainer(containerInfo.containerId);
      const info = await container.inspect();
      return info.State.Running ? 'running' : 'stopped';
    } catch {
      return 'error';
    }
  }

  /**
   * Stop all containers for a user
   */
  async stopAllUserContainers(userId: string): Promise<number> {
    const projectIds = await this.getUserContainers(userId);
    let stoppedCount = 0;
    
    for (const projectId of projectIds) {
      try {
        await this.stopPreview(projectId);
        stoppedCount++;
      } catch (err) {
        console.error(`[PreviewManager] Error stopping container ${projectId}:`, err);
      }
    }
    
    return stoppedCount;
  }

  /**
   * Clean up all preview containers (admin use)
   */
  async cleanupAll(): Promise<void> {
    try {
      const containers = await docker.listContainers({ all: true });
      
      for (const containerInfo of containers) {
        const containerName = containerInfo.Names?.[0]?.replace('/', '') || '';
        if (containerName.startsWith('preview-')) {
          const projectId = containerName.replace('preview-', '');
          await this.stopPreview(projectId);
        }
      }
      
      // Clear all Redis state
      const redis = await getRedisClient();
      await redis.del(REDIS_KEYS.USED_PORTS);
      
      console.log('[PreviewManager] Cleaned up all preview containers');
    } catch (err) {
      console.error('[PreviewManager] Error cleaning up all containers:', err);
    }
  }

  /**
   * Cleanup idle containers based on timeout
   */
  async cleanupIdleContainers(): Promise<number> {
    let cleanedCount = 0;
    const timeoutMs = CONTAINER_LIMITS.CONTAINER_TIMEOUT_MINUTES * 60 * 1000;
    const now = Date.now();
    
    try {
      const containers = await docker.listContainers({ all: true });
      
      for (const containerInfo of containers) {
        const containerName = containerInfo.Names?.[0]?.replace('/', '') || '';
        if (containerName.startsWith('preview-')) {
          const projectId = containerName.replace('preview-', '');
          const redisContainer = await this.getContainerFromRedis(projectId);
          
          if (redisContainer) {
            const lastAccessed = new Date(redisContainer.lastAccessedAt).getTime();
            if (now - lastAccessed > timeoutMs) {
              console.log(`[PreviewManager] Container ${projectId} idle for too long, cleaning up`);
              await this.stopPreview(projectId);
              cleanedCount++;
            }
          } else {
            // Container exists in Docker but not in Redis - orphaned, clean it up
            console.log(`[PreviewManager] Orphaned container ${projectId}, cleaning up`);
            await this.stopPreview(projectId);
            cleanedCount++;
          }
        }
      }
    } catch (err) {
      console.error('[PreviewManager] Error cleaning up idle containers:', err);
    }
    
    return cleanedCount;
  }
}

export const previewManager = new PreviewManager();
