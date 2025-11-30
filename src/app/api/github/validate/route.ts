import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { parseGitHubUrl, validateGitHubRepo } from '@/lib/git-manager';

/**
 * POST /api/github/validate
 * Validate a GitHub repository URL
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'GitHub URL is required' },
        { status: 400 }
      );
    }

    // Parse the URL
    const parsed = parseGitHubUrl(url.trim());
    if (!parsed.isValid) {
      return NextResponse.json({
        valid: false,
        error: 'Invalid GitHub URL format. Expected: https://github.com/owner/repo',
      });
    }

    // Get user's GitHub token if available
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    const accessToken = user?.githubAccessToken || undefined;

    // Validate the repository
    const validation = await validateGitHubRepo(url.trim(), accessToken);

    if (!validation.valid) {
      return NextResponse.json({
        valid: false,
        error: validation.error,
        requiresAuth: validation.error?.includes('Private repository'),
      });
    }

    // Return repo info
    return NextResponse.json({
      valid: true,
      repo: {
        name: validation.repoInfo?.name,
        fullName: validation.repoInfo?.full_name,
        description: validation.repoInfo?.description,
        owner: parsed.owner,
        isPrivate: validation.repoInfo?.private,
        defaultBranch: validation.repoInfo?.default_branch,
        language: validation.repoInfo?.language,
        stargazersCount: validation.repoInfo?.stargazers_count,
        htmlUrl: validation.repoInfo?.html_url,
      },
    });
  } catch (error) {
    console.error('Error validating GitHub URL:', error);
    return NextResponse.json(
      { error: 'Failed to validate GitHub URL' },
      { status: 500 }
    );
  }
}
