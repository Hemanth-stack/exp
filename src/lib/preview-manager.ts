import Docker from 'dockerode';
import path from 'path';
import fs from 'fs/promises';

const docker = new Docker();

export interface PreviewContainer {
  containerId: string;
  port: number;
  projectId: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
}

class PreviewManager {
  private containers = new Map<string, PreviewContainer>();
  private portStart = 4001;
  private portEnd = 5000;
  private usedPorts = new Set<number>();

  private findAvailablePort(): number {
    for (let port = this.portStart; port <= this.portEnd; port++) {
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error('No available ports for preview');
  }

  async startPreview(projectId: string, repoPath: string): Promise<PreviewContainer> {
    // Check if already running
    const existing = this.containers.get(projectId);
    if (existing && existing.status === 'running') {
      return existing;
    }

    const port = this.findAvailablePort();
    
    try {
      // Try to remove any existing container with the same name
      const containerName = `preview-${projectId}`;
      try {
        const oldContainer = docker.getContainer(containerName);
        const info = await oldContainer.inspect();
        console.log(`Found existing container ${containerName}, removing...`);
        if (info.State.Running) {
          await oldContainer.stop();
        }
        await oldContainer.remove();
      } catch (err: any) {
        // Container doesn't exist, which is fine
        if (err.statusCode !== 404) {
          console.error('Error cleaning up old container:', err);
        }
      }

      // Check if package.json exists
      const packagePath = path.join(repoPath, 'package.json');
      await fs.access(packagePath);
      const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf-8'));

      // Determine if this is a Next.js project
      const isNextJs = packageJson.dependencies?.next || packageJson.devDependencies?.next;
      
      // Use our sandbox image for Next.js projects, or generic node for others
      const imageName = isNextJs ? 'nextjs-sandbox:latest' : 'node:18-alpine';
      const devCommand = packageJson.scripts?.dev || 'npm run dev';
      
      // Create container for development
      const container = await docker.createContainer({
        Image: imageName,
        name: `preview-${projectId}`,
        WorkingDir: '/app',
        // For sandbox image, use the built-in start.sh which handles user projects
        // For generic image, manually install and run
        Cmd: isNextJs 
          ? undefined  // Use default CMD from Dockerfile (start.sh)
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
      });

      await container.start();

      const previewContainer: PreviewContainer = {
        containerId: container.id,
        port,
        projectId,
        status: 'starting',
      };

      this.containers.set(projectId, previewContainer);

      // Wait for the server to start
      // Next.js needs more time, especially on first start with npm install
      // For sandbox with user project: ~20-30 seconds (includes npm install)
      // For template only: ~8-10 seconds
      const startupTime = isNextJs ? 30000 : 8000;
      
      // Start a background check for container readiness
      this.waitForContainerReady(projectId, container.id, port, startupTime);

      return previewContainer;
    } catch (error) {
      this.usedPorts.delete(port);
      throw error;
    }
  }

  private async waitForContainerReady(
    projectId: string, 
    containerId: string, 
    port: number,
    maxWaitTime: number
  ): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 2000; // Check every 2 seconds
    
    const check = async () => {
      try {
        const container = docker.getContainer(containerId);
        const info = await container.inspect();
        
        // If container stopped, mark as error
        if (!info.State.Running) {
          const current = this.containers.get(projectId);
          if (current) {
            current.status = 'error';
          }
          console.error(`Container ${containerId} stopped unexpectedly`);
          return;
        }

        // Try to fetch from the port to see if Next.js is ready
        try {
          const response = await fetch(`http://localhost:${port}`, {
            signal: AbortSignal.timeout(1000)
          });
          
          if (response.ok || response.status === 404) {
            // Next.js is responding (even 404 means it's up)
            const current = this.containers.get(projectId);
            if (current) {
              current.status = 'running';
              console.log(`Preview container ${projectId} is now ready on port ${port}`);
            }
            return;
          }
        } catch (fetchError) {
          // Server not ready yet, keep checking
        }

        // Check if we've exceeded max wait time
        if (Date.now() - startTime < maxWaitTime) {
          setTimeout(check, checkInterval);
        } else {
          // Timeout - mark as running anyway, user can refresh
          const current = this.containers.get(projectId);
          if (current) {
            current.status = 'running';
          }
          console.log(`Preview container ${projectId} marked as running after timeout`);
        }
      } catch (error) {
        console.error('Error checking container readiness:', error);
        const current = this.containers.get(projectId);
        if (current) {
          current.status = 'error';
        }
      }
    };

    // Start checking
    setTimeout(check, checkInterval);
  }

  async stopPreview(projectId: string): Promise<void> {
    const previewContainer = this.containers.get(projectId);
    if (!previewContainer) return;

    try {
      const container = docker.getContainer(previewContainer.containerId);
      await container.stop();
      await container.remove();
      this.usedPorts.delete(previewContainer.port);
      this.containers.delete(projectId);
    } catch (error) {
      console.error('Error stopping preview:', error);
    }
  }

  async restartPreview(projectId: string): Promise<PreviewContainer> {
    await this.stopPreview(projectId);
    const container = this.containers.get(projectId);
    if (!container) throw new Error('Container not found');
    
    // Get repo path from somewhere (would need to be stored)
    throw new Error('Restart not fully implemented - need repo path');
  }

  getPreview(projectId: string): PreviewContainer | undefined {
    return this.containers.get(projectId);
  }

  async getPreviewStatus(projectId: string): Promise<string> {
    const previewContainer = this.containers.get(projectId);
    if (!previewContainer) return 'stopped';

    try {
      const container = docker.getContainer(previewContainer.containerId);
      const info = await container.inspect();
      return info.State.Running ? 'running' : 'stopped';
    } catch (error) {
      return 'error';
    }
  }

  async cleanupAll(): Promise<void> {
    const promises = Array.from(this.containers.keys()).map((projectId) =>
      this.stopPreview(projectId)
    );
    await Promise.all(promises);
  }
}

export const previewManager = new PreviewManager();
