import Docker from 'dockerode';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { isNotNull } from 'drizzle-orm';

const docker = new Docker();

const PORT_START = parseInt(process.env.DOCKER_CONTAINER_PORT_START || '3001');
const PORT_END = parseInt(process.env.DOCKER_CONTAINER_PORT_END || '4000');

export class ContainerManager {
  /**
   * Get all ports currently in use by Docker project containers
   */
  private async getDockerProjectPorts(): Promise<Set<number>> {
    const usedPorts = new Set<number>();
    try {
      const containers = await docker.listContainers({ all: true });
      for (const container of containers) {
        const containerName = container.Names?.[0]?.replace('/', '') || '';
        if (containerName.startsWith('project-')) {
          for (const port of container.Ports || []) {
            if (port.PublicPort) {
              usedPorts.add(port.PublicPort);
            }
          }
        }
      }
    } catch (err) {
      console.error('[ContainerManager] Error getting Docker ports:', err);
    }
    return usedPorts;
  }

  private async getAvailablePort(): Promise<number> {
    // Get ports from database
    const allocatedPorts = await db
      .select({ containerPort: projects.containerPort })
      .from(projects)
      .where(isNotNull(projects.containerId));

    const dbPorts = new Set(
      allocatedPorts
        .map((p) => p.containerPort)
        .filter((port): port is number => port !== null)
    );

    // Get ports from actual Docker containers
    const dockerPorts = await this.getDockerProjectPorts();

    // Combine both sources
    const usedPorts = new Set([...dbPorts, ...dockerPorts]);

    for (let port = PORT_START; port <= PORT_END; port++) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }

    throw new Error('No available ports');
  }

  /**
   * Clean up existing container for a project before starting a new one
   */
  private async cleanupExistingContainer(projectId: string): Promise<void> {
    const containerName = `project-${projectId}`;
    try {
      const container = docker.getContainer(containerName);
      const info = await container.inspect();
      console.log(`[ContainerManager] Found existing container ${containerName}, removing...`);
      
      if (info.State.Running) {
        await container.stop();
      }
      await container.remove();
    } catch (err: unknown) {
      const dockerErr = err as { statusCode?: number };
      if (dockerErr.statusCode !== 404) {
        console.error('[ContainerManager] Error cleaning up container:', err);
      }
      // Container doesn't exist, which is fine
    }
  }

  async startContainer(projectId: string, template: string, repoPath: string): Promise<{
    containerId: string;
    port: number;
  }> {
    // Clean up any existing container for this project
    await this.cleanupExistingContainer(projectId);

    const port = await this.getAvailablePort();
    const containerName = `project-${projectId}`;

    // Create container
    const container = await docker.createContainer({
      Image: 'node:20-alpine',
      name: containerName,
      Cmd: ['sh', '-c', 'npm install && npm run dev'],
      WorkingDir: '/app',
      ExposedPorts: {
        '3000/tcp': {},
      },
      HostConfig: {
        Binds: [`${repoPath}:/app`],
        PortBindings: {
          '3000/tcp': [{ HostPort: port.toString() }],
        },
      },
    });

    await container.start();

    return {
      containerId: container.id,
      port,
    };
  }

  async stopContainer(containerId: string): Promise<void> {
    try {
      const container = docker.getContainer(containerId);
      await container.stop();
      await container.remove();
    } catch {
      console.error('Error stopping container');
    }
  }

  async getContainerStatus(containerId: string): Promise<string> {
    try {
      const container = docker.getContainer(containerId);
      const info = await container.inspect();
      return info.State.Status;
    } catch {
      return 'not_found';
    }
  }

  async getContainerLogs(containerId: string): Promise<string> {
    try {
      const container = docker.getContainer(containerId);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: 100,
      });
      return logs.toString();
    } catch {
      return 'Error fetching logs';
    }
  }
}

export const containerManager = new ContainerManager();
