/**
 * Preview Manager with Redis State Management
 * Manages Docker preview containers with multi-user support and container limits
 */

import Docker from 'dockerode';
import path from 'path';
import fs from 'fs/promises';
import { getRedisClient, REDIS_KEYS, CONTAINER_LIMITS } from './redis';

const docker = new Docker();

// Host path for user-repos volume binding (Docker-in-Docker requires host paths)
// Lazy initialization to avoid errors during build
let _hostUserReposPath: string | null = null;

function getHostUserReposPath(): string {
  if (_hostUserReposPath) return _hostUserReposPath;
  
  if (process.env.HOST_USER_REPOS_PATH) {
    _hostUserReposPath = process.env.HOST_USER_REPOS_PATH;
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('HOST_USER_REPOS_PATH environment variable is required in production');
  } else {
    _hostUserReposPath = path.join(process.cwd(), 'user-repos');
  }
  
  return _hostUserReposPath;
}

/**
 * Convert container path to host path for Docker-in-Docker volume mounting
 * When running inside a container, we need to use the actual host path
 */
function getHostPath(containerPath: string): string {
  // If running in production (Docker) and path starts with /app/user-repos
  if (process.env.NODE_ENV === 'production' && containerPath.startsWith('/app/user-repos')) {
    const relativePath = containerPath.replace('/app/user-repos', '');
    return path.join(getHostUserReposPath(), relativePath);
  }
  return containerPath;
}

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

interface ProjectConfig {
  type: string;
  supported: boolean;
  errorMessage?: string;
  image: string;
  command?: string[];
  workDir: string;
  mountPath: string;
  containerPort: number;
  env: string[];
  startupTime: number;
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
      // Detect project type and get container config
      const projectConfig = await this.detectProjectType(repoPath);
      console.log(`[PreviewManager] Detected project type: ${projectConfig.type}`);

      if (!projectConfig.supported) {
        throw new Error(projectConfig.errorMessage || 'Unsupported project type');
      }

      // Get the host path for Docker-in-Docker volume binding
      const hostRepoPath = getHostPath(repoPath);
      console.log(`[PreviewManager] Using host path for volume: ${hostRepoPath}`);

      // Create container based on project type
      const container = await docker.createContainer({
        Image: projectConfig.image,
        name: `preview-${projectId}`,
        WorkingDir: projectConfig.workDir,
        Cmd: projectConfig.command,
        Tty: true,
        OpenStdin: true,
        User: 'root', // Run as root to avoid permission issues with mounted volumes
        ExposedPorts: {
          [`${projectConfig.containerPort}/tcp`]: {},
        },
        HostConfig: {
          PortBindings: {
            [`${projectConfig.containerPort}/tcp`]: [{ HostPort: port.toString() }],
          },
          Binds: [`${hostRepoPath}:${projectConfig.mountPath}`],
          AutoRemove: false,
        },
        Env: projectConfig.env,
        Labels: {
          'preview.projectId': projectId,
          'preview.userId': userId,
          'preview.type': projectConfig.type,
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
      this.waitForContainerReady(projectId, container.id, port, projectConfig.startupTime);

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
   * Detect project type and return container configuration
   */
  private async detectProjectType(repoPath: string): Promise<ProjectConfig> {
    // Check for various project files
    const checks = await Promise.all([
      this.fileExists(path.join(repoPath, 'package.json')),
      this.fileExists(path.join(repoPath, 'requirements.txt')),
      this.fileExists(path.join(repoPath, 'pyproject.toml')),
      this.fileExists(path.join(repoPath, 'pom.xml')),
      this.fileExists(path.join(repoPath, 'build.gradle')),
      this.fileExists(path.join(repoPath, 'index.html')),
      this.fileExists(path.join(repoPath, 'Cargo.toml')),
      this.fileExists(path.join(repoPath, 'go.mod')),
    ]);

    const [hasPackageJson, hasRequirements, hasPyproject, hasPom, hasGradle, hasIndexHtml, hasCargo, hasGoMod] = checks;

    // JavaScript/TypeScript project
    if (hasPackageJson) {
      return this.getNodeProjectConfig(repoPath);
    }

    // Python project
    if (hasRequirements || hasPyproject) {
      return this.getPythonProjectConfig(repoPath, hasRequirements);
    }

    // Java project
    if (hasPom || hasGradle) {
      return this.getJavaProjectConfig(repoPath, hasPom);
    }

    // Static HTML project
    if (hasIndexHtml) {
      return this.getStaticProjectConfig(repoPath);
    }

    // Go project
    if (hasGoMod) {
      return {
        type: 'go',
        supported: false,
        errorMessage: 'Go projects are not yet supported for preview. Coming soon!',
        image: '',
        command: [],
        workDir: '',
        mountPath: '',
        containerPort: 8080,
        env: [],
        startupTime: 10000,
      };
    }

    // Rust project
    if (hasCargo) {
      return {
        type: 'rust',
        supported: false,
        errorMessage: 'Rust projects are not yet supported for preview. Coming soon!',
        image: '',
        command: [],
        workDir: '',
        mountPath: '',
        containerPort: 8080,
        env: [],
        startupTime: 10000,
      };
    }

    // Unknown project type
    return {
      type: 'unknown',
      supported: false,
      errorMessage: 'Could not detect project type. Supported types: Node.js (Next.js, React, Vue, Angular, Svelte, Vite), Python (Flask, Django, FastAPI), Java (Spring Boot, Maven, Gradle), Static HTML.',
      image: '',
      command: [],
      workDir: '',
      mountPath: '',
      containerPort: 3000,
      env: [],
      startupTime: 10000,
    };
  }

  /**
   * Get Node.js project configuration
   */
  private async getNodeProjectConfig(repoPath: string): Promise<ProjectConfig> {
    const packagePath = path.join(repoPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // Detect framework
    const isNextJs = !!deps['next'];
    const isVue = !!deps['vue'];
    const isAngular = !!deps['@angular/core'];
    const isSvelte = !!deps['svelte'];
    const isVite = !!deps['vite'];
    const isExpress = !!deps['express'];
    const isReact = !!deps['react'] || !!deps['react-dom'];

    let type = 'node';
    let image = 'node:18-alpine';
    let command: string[];
    let containerPort = 3000;
    let startupTime = 15000;
    let workDir = '/app';
    let mountPath = '/app';

    // Optimized install command - skip if node_modules exists, use npm ci if lock file exists
    const fastInstall = '[ -d node_modules ] || ([ -f package-lock.json ] && npm ci --legacy-peer-deps 2>/dev/null || npm install --legacy-peer-deps 2>/dev/null)';

    if (isNextJs) {
      type = 'nextjs';
      // Check if custom sandbox image exists, otherwise use node:18-alpine
      const useCustomImage = await this.dockerImageExists('nextjs-sandbox:latest');
      if (useCustomImage) {
        image = 'nextjs-sandbox:latest';
        // Use exec to ensure proper process management and signal handling
        command = ['sh', '-c', `cd /app/user-project && ${fastInstall}; exec npm run dev`];
        workDir = '/app';
        mountPath = '/app/user-project';
      } else {
        image = 'node:18-alpine';
        command = ['sh', '-c', `${fastInstall}; exec npm run dev`];
        workDir = '/app';
        mountPath = '/app';
      }
      startupTime = 20000; // Reduced from 30000 with optimized install
    } else if (isVue) {
      type = 'vue';
      command = ['sh', '-c', `${fastInstall}; exec npm run dev -- --host 0.0.0.0`];
      containerPort = 5173;
      startupTime = 15000; // Reduced from 20000
    } else if (isAngular) {
      type = 'angular';
      command = ['sh', '-c', `${fastInstall}; exec npx ng serve --host 0.0.0.0 --disable-host-check`];
      containerPort = 4200;
      startupTime = 35000; // Reduced from 45000
    } else if (isSvelte) {
      type = 'svelte';
      command = ['sh', '-c', `${fastInstall}; exec npm run dev -- --host 0.0.0.0`];
      containerPort = 5173;
      startupTime = 12000; // Reduced from 15000
    } else if (isVite) {
      type = 'vite';
      command = ['sh', '-c', `${fastInstall}; exec npm run dev -- --host 0.0.0.0`];
      containerPort = 5173;
      startupTime = 12000; // Reduced from 15000
    } else if (isReact) {
      // React without Vite (create-react-app style)
      type = 'react';
      command = ['sh', '-c', `${fastInstall}; exec npm start`];
      containerPort = 3000;
      startupTime = 25000; // Reduced from 30000
    } else if (isExpress) {
      type = 'express';
      command = ['sh', '-c', `${fastInstall}; exec npm start`];
      startupTime = 8000; // Reduced from 10000
    } else {
      // Generic Node.js - try to detect the right start command
      const scripts = packageJson.scripts || {};
      let startCmd = 'npm start';
      
      if (scripts.dev) {
        startCmd = 'npm run dev';
      } else if (scripts.start) {
        startCmd = 'npm start';
      } else if (scripts.serve) {
        startCmd = 'npm run serve';
      }
      
      command = ['sh', '-c', `${fastInstall}; exec ${startCmd}`];
    }

    return {
      type,
      supported: true,
      image,
      command,
      workDir,
      mountPath,
      containerPort,
      env: [
        'NODE_ENV=development',
        `PORT=${containerPort}`,
        'HOST=0.0.0.0',
        'HOSTNAME=0.0.0.0',
      ],
      startupTime,
    };
  }

  /**
   * Check if a Docker image exists locally
   */
  private async dockerImageExists(imageName: string): Promise<boolean> {
    try {
      const images = await docker.listImages();
      return images.some(img => 
        img.RepoTags?.includes(imageName) || 
        img.RepoTags?.some(tag => tag.startsWith(imageName.split(':')[0]))
      );
    } catch {
      return false;
    }
  }

  /**
   * Get Python project configuration
   */
  private async getPythonProjectConfig(repoPath: string, hasRequirements: boolean): Promise<ProjectConfig> {
    // Check for common Python web frameworks
    let framework = 'python';
    let command: string[];
    let containerPort = 8000;

    // Read requirements to detect framework
    if (hasRequirements) {
      try {
        const requirements = await fs.readFile(path.join(repoPath, 'requirements.txt'), 'utf-8');
        const reqLower = requirements.toLowerCase();

        if (reqLower.includes('django')) {
          framework = 'django';
          command = ['sh', '-c', 'pip install -r requirements.txt && python manage.py runserver 0.0.0.0:8000'];
        } else if (reqLower.includes('flask')) {
          framework = 'flask';
          command = ['sh', '-c', 'pip install -r requirements.txt && flask run --host=0.0.0.0 --port=8000'];
        } else if (reqLower.includes('fastapi')) {
          framework = 'fastapi';
          command = ['sh', '-c', 'pip install -r requirements.txt && uvicorn main:app --host 0.0.0.0 --port 8000 --reload'];
        } else if (reqLower.includes('streamlit')) {
          framework = 'streamlit';
          containerPort = 8501;
          command = ['sh', '-c', 'pip install -r requirements.txt && streamlit run app.py --server.address 0.0.0.0'];
        } else {
          // Generic Python - try to find main file
          const mainFiles = ['main.py', 'app.py', 'run.py', 'server.py'];
          let mainFile = 'main.py';
          for (const f of mainFiles) {
            if (await this.fileExists(path.join(repoPath, f))) {
              mainFile = f;
              break;
            }
          }
          command = ['sh', '-c', `pip install -r requirements.txt && python ${mainFile}`];
        }
      } catch {
        command = ['sh', '-c', 'pip install -r requirements.txt && python main.py'];
      }
    } else {
      // pyproject.toml based project
      command = ['sh', '-c', 'pip install -e . && python -m app'];
    }

    return {
      type: framework,
      supported: true,
      image: 'python:3.11-slim',
      command,
      workDir: '/app',
      mountPath: '/app',
      containerPort,
      env: [
        'PYTHONUNBUFFERED=1',
        'FLASK_APP=app.py',
        'FLASK_ENV=development',
      ],
      startupTime: 20000,
    };
  }

  /**
   * Get Java project configuration
   */
  private async getJavaProjectConfig(repoPath: string, hasPom: boolean): Promise<ProjectConfig> {
    const buildTool = hasPom ? 'maven' : 'gradle';
    let command: string[];

    if (hasPom) {
      command = ['sh', '-c', 'mvn spring-boot:run -Dspring-boot.run.arguments="--server.address=0.0.0.0"'];
    } else {
      command = ['sh', '-c', './gradlew bootRun --args="--server.address=0.0.0.0"'];
    }

    return {
      type: `java-${buildTool}`,
      supported: true,
      image: 'maven:3.9-eclipse-temurin-17',
      command,
      workDir: '/app',
      mountPath: '/app',
      containerPort: 8080,
      env: [
        'JAVA_OPTS=-Xmx512m',
        'SERVER_PORT=8080',
      ],
      startupTime: 60000, // Java apps take longer to start
    };
  }

  /**
   * Get static HTML project configuration
   */
  private async getStaticProjectConfig(_repoPath: string): Promise<ProjectConfig> {
    return {
      type: 'static',
      supported: true,
      image: 'nginx:alpine',
      command: undefined, // nginx uses default command
      workDir: '/usr/share/nginx/html',
      mountPath: '/usr/share/nginx/html',
      containerPort: 80,
      env: [],
      startupTime: 5000,
    };
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
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
    const checkInterval = 1500; // Reduced from 2000ms for faster response
    
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
            signal: AbortSignal.timeout(800) // Reduced timeout for faster checks
          });
          
          if (response.ok || response.status === 404 || response.status === 500) {
            // 500 can mean the app is running but has an error - still "ready"
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

    // Start checking immediately instead of waiting for first interval
    setTimeout(check, 500);
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
