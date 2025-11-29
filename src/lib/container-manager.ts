import Docker from 'dockerode';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { eq, isNull } from 'drizzle-orm';
import path from 'path';

const docker = new Docker();

const PORT_START = parseInt(process.env.DOCKER_CONTAINER_PORT_START || '3001');
const PORT_END = parseInt(process.env.DOCKER_CONTAINER_PORT_END || '4000');

export class ContainerManager {
  private async getAvailablePort(): Promise<number> {
    const allocatedPorts = await db
      .select({ containerPort: projects.containerPort })
      .from(projects)
      .where(isNull(projects.containerId).not());

    const usedPorts = new Set(
      allocatedPorts
        .map((p) => p.containerPort)
        .filter((port): port is number => port !== null)
    );

    for (let port = PORT_START; port <= PORT_END; port++) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }

    throw new Error('No available ports');
  }

  async startContainer(projectId: string, template: string, repoPath: string): Promise<{
    containerId: string;
    port: number;
  }> {
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
    } catch (error) {
      console.error('Error stopping container:', error);
    }
  }

  async getContainerStatus(containerId: string): Promise<string> {
    try {
      const container = docker.getContainer(containerId);
      const info = await container.inspect();
      return info.State.Status;
    } catch (error) {
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
    } catch (error) {
      return 'Error fetching logs';
    }
  }
}

export const containerManager = new ContainerManager();
