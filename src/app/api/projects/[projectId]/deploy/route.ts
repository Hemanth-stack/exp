import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { projects, deployments } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { GitManager } from '@/lib/git-manager';
import Docker from 'dockerode';

const docker = new Docker();

async function buildProject(repoPath: string): Promise<{ success: boolean; logs: string }> {
  let logs = '';
  
  try {
    logs += '📦 Installing dependencies...\n';
    const container = await docker.createContainer({
      Image: 'node:18-alpine',
      WorkingDir: '/app',
      Cmd: ['sh', '-c', 'npm install && npm run build'],
      HostConfig: {
        Binds: [`${repoPath}:/app`],
        AutoRemove: true,
      },
    });

    await container.start();
    
    // Stream logs
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    });

    logs += await new Promise<string>((resolve) => {
      let output = '';
      stream.on('data', (chunk) => {
        output += chunk.toString();
      });
      stream.on('end', () => resolve(output));
    });

    const result = await container.wait();
    
    if (result.StatusCode === 0) {
      logs += '\n✅ Build successful!\n';
      return { success: true, logs };
    } else {
      logs += '\n❌ Build failed!\n';
      return { success: false, logs };
    }
  } catch (error) {
    logs += `\n❌ Error: ${error}\n`;
    return { success: false, logs };
  }
}

async function deployProject(
  projectId: string,
  projectName: string,
  repoPath: string
): Promise<{ url: string; containerId: string }> {
  try {
    // Check if deployment container already exists
    const containers = await docker.listContainers({ all: true });
    const existing = containers.find(c => c.Names.includes(`/deploy-${projectId}`));
    
    if (existing) {
      const container = docker.getContainer(existing.Id);
      if (existing.State !== 'running') {
        await container.start();
      }
      const port = existing.Ports.find(p => p.PrivatePort === 3000)?.PublicPort || 3000;
      return {
        url: `http://localhost:${port}`,
        containerId: existing.Id,
      };
    }

    // Find available port
    const usedPorts = containers
      .flatMap(c => c.Ports.map(p => p.PublicPort))
      .filter(Boolean);
    let port = 5001;
    while (usedPorts.includes(port)) {
      port++;
    }

    // Create production container
    const container = await docker.createContainer({
      Image: 'node:18-alpine',
      name: `deploy-${projectId}`,
      WorkingDir: '/app',
      Cmd: ['sh', '-c', 'npm run start'],
      ExposedPorts: {
        '3000/tcp': {},
      },
      HostConfig: {
        PortBindings: {
          '3000/tcp': [{ HostPort: port.toString() }],
        },
        Binds: [`${repoPath}:/app`],
        RestartPolicy: {
          Name: 'unless-stopped',
        },
      },
      Env: [
        'NODE_ENV=production',
        'PORT=3000',
      ],
      Labels: {
        'app.project-id': projectId,
        'app.project-name': projectName,
      },
    });

    await container.start();

    return {
      url: `http://localhost:${port}`,
      containerId: container.id,
    };
  } catch (error) {
    console.error('Deploy error:', error);
    throw error;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;

    // Get project
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project || project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (!project.gitRepoPath) {
      return NextResponse.json({ error: 'Project repository not initialized' }, { status: 400 });
    }

    // Get current git commit
    const gitManager = new GitManager();
    const log = await gitManager.getLog(project.gitRepoPath, 1);
    const commitSha = log[0]?.hash || 'initial';

    // Create deployment record
    const [deployment] = await db
      .insert(deployments)
      .values({
        projectId: project.id,
        commitSha,
        status: 'building',
      })
      .returning();

    // Build project
    const buildResult = await buildProject(project.gitRepoPath);

    if (!buildResult.success) {
      await db
        .update(deployments)
        .set({
          status: 'failed',
          logs: buildResult.logs,
        })
        .where(eq(deployments.id, deployment.id));

      return NextResponse.json({
        error: 'Build failed',
        logs: buildResult.logs,
      }, { status: 400 });
    }

    // Deploy
    const { url } = await deployProject(
      project.id,
      project.name,
      project.gitRepoPath
    );

    // Update deployment record
    await db
      .update(deployments)
      .set({
        status: 'deployed',
        deployUrl: url,
        logs: buildResult.logs,
      })
      .where(eq(deployments.id, deployment.id));

    return NextResponse.json({
      deployment: {
        id: deployment.id,
        url,
        status: 'deployed',
        logs: buildResult.logs,
      },
    });
  } catch (error) {
    console.error('Error deploying project:', error);
    return NextResponse.json({ error: 'Failed to deploy project' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;

    // Get project
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project || project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get deployment history
    const history = await db
      .select()
      .from(deployments)
      .where(eq(deployments.projectId, project.id))
      .orderBy(deployments.createdAt);

    return NextResponse.json({ deployments: history });
  } catch (error) {
    console.error('Error fetching deployments:', error);
    return NextResponse.json({ error: 'Failed to fetch deployments' }, { status: 500 });
  }
}
