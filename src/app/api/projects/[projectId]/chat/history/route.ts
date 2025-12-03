/**
 * Chat History API
 * Retrieves conversation history for a project
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { messages, conversations, projects } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;

    // Validate project exists and belongs to user
    const [project] = await db
      .select()
      .from(projects)
      .where(and(
        eq(projects.id, projectId),
        eq(projects.userId, session.user.id)
      ))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get conversation ID from query params
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');
    const limit = parseInt(searchParams.get('limit') || '50');

    if (!conversationId) {
      // Return latest conversation for this project
      const [latestConversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.projectId, projectId))
        .orderBy(desc(conversations.createdAt))
        .limit(1);

      if (!latestConversation) {
        return NextResponse.json({ 
          messages: [],
          conversationId: null,
        });
      }

      const conversationMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, latestConversation.id))
        .orderBy(messages.createdAt)
        .limit(limit);

      return NextResponse.json({
        messages: conversationMessages,
        conversationId: latestConversation.id,
      });
    }

    // Get specific conversation
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId)
      ))
      .limit(1);

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const conversationMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt)
      .limit(limit);

    return NextResponse.json({
      messages: conversationMessages,
      conversationId: conversation.id,
    });

  } catch (error) {
    console.error('[Chat History API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
