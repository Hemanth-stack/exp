import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { gitManager } from '@/lib/git-manager';

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  template: z.enum(['nextjs', 'vite-react']),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, session.user.id));

    return NextResponse.json(userProjects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, template } = createProjectSchema.parse(body);

    // Check project limit
    const userProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, session.user.id));

    if (userProjects.length >= session.user.maxProjects) {
      return NextResponse.json(
        { error: 'Project limit reached' },
        { status: 403 }
      );
    }

    // Create new project
    const [newProject] = await db
      .insert(projects)
      .values({
        userId: session.user.id,
        name,
        description,
        template,
        status: 'created',
      })
      .returning();

    // Initialize git repository
    try {
      const repoPath = await gitManager.initRepository(newProject.id, template);
      await db
        .update(projects)
        .set({ gitRepoPath: repoPath })
        .where(eq(projects.id, newProject.id));
    } catch (error) {
      console.error('Error initializing git repository:', error);
    }

    return NextResponse.json(newProject, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error creating project:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
