import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { db } from '@/db';
import { projects, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';
import { gitManager, normalizeRepoPath } from '@/lib/git-manager';
import { checkRateLimit, createRateLimitHeaders, getRateLimitIdentifier, RATE_LIMITS } from '@/lib/rate-limit';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

// Maximum file size for writes (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Allowed file extensions for creation/modification
const ALLOWED_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.md', '.txt', '.html', '.css', '.scss', '.less',
  '.vue', '.svelte', '.astro',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
  '.yaml', '.yml', '.toml', '.ini', '.env', '.env.local', '.env.example',
  '.sh', '.bash', '.zsh',
  '.svg', '.xml',
  '.gitignore', '.npmrc', '.nvmrc', '.prettierrc', '.eslintrc',
  '', // Files without extension like Dockerfile, Makefile
]);

// Validate project ID format (UUID)
function isValidProjectId(projectId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);
}

// Validate file path - prevent path traversal and dangerous patterns
function isValidFilePath(filePath: string): boolean {
  // Must not be empty
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  
  // Must not contain null bytes
  if (filePath.includes('\0')) {
    return false;
  }
  
  // Must not contain path traversal
  const normalized = path.normalize(filePath);
  if (normalized.includes('..') || normalized.startsWith('/') || normalized.startsWith('\\')) {
    return false;
  }
  
  // Must not contain dangerous patterns
  const dangerousPatterns = [
    /node_modules/i,
    /\.git\//i,
    /\.git$/i,
    /\.env(?!\.example)/i, // Allow .env.example but not .env, .env.local, etc.
    /\.pem$/i,
    /\.key$/i,
    /id_rsa/i,
    /password/i,
    /secret/i,
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(filePath)) {
      return false;
    }
  }
  
  // Check file extension
  const ext = path.extname(filePath).toLowerCase();
  
  // Allow files without extension (like Dockerfile, Makefile)
  if (!ext && !ALLOWED_EXTENSIONS.has('')) {
    return false;
  }
  
  // Check if extension is allowed
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    return false;
  }
  
  return true;
}

// Sanitize file content to prevent injection attacks
function sanitizeContent(content: string): string {
  // Remove null bytes
  return content.replace(/\0/g, '');
}

async function buildFileTree(dirPath: string, basePath: string = ''): Promise<FileNode[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: FileNode[] = [];

    // Filter out node_modules, .git, .next, etc.
    const filtered = entries.filter(entry => {
      const name = entry.name;
      return !name.startsWith('.') && 
             name !== 'node_modules' && 
             name !== 'dist' &&
             name !== 'build' &&
             name !== '.next';
    });

    for (const entry of filtered) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        const children = await buildFileTree(fullPath, relativePath);
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'directory',
          children,
        });
      } else {
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'file',
        });
      }
    }

    return nodes.sort((a, b) => {
      // Directories first
      if (a.type === 'directory' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error('Error building file tree:', error);
    return [];
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

    // Rate limiting
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimit = checkRateLimit(identifier, RATE_LIMITS.files);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: createRateLimitHeaders(rateLimit) });
    }

    if (!isValidProjectId(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    // Get user and verify project ownership
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

    // Normalize the repo path for Docker environment
    const repoPath = normalizeRepoPath(project.gitRepoPath);
    const files = await buildFileTree(repoPath);

    return NextResponse.json({ files });
  } catch (error) {
    console.error('Error fetching files:', error);
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
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
    const body = await request.json();
    const { filePath: relativePath, content, type } = body;

    // Rate limiting
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimit = checkRateLimit(identifier, RATE_LIMITS.files);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: createRateLimitHeaders(rateLimit) });
    }

    if (!isValidProjectId(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    if (!isValidFilePath(relativePath)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    // Get user and verify project ownership
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

    // Get user's GitHub access token for pushing
    const [user] = await db
      .select({ githubAccessToken: users.githubAccessToken })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    const githubAccessToken = user?.githubAccessToken || undefined;

    // Normalize the repo path for Docker environment
    const repoPath = normalizeRepoPath(project.gitRepoPath);

    // Security: ensure path doesn't escape project directory
    const fullPath = path.join(repoPath, relativePath);
    if (!fullPath.startsWith(repoPath)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    // Check file size
    const contentSize = Buffer.byteLength(content, 'utf8');
    if (contentSize > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File size exceeds limit' }, { status: 400 });
    }

    if (type === 'directory') {
      await fs.mkdir(fullPath, { recursive: true });
    } else {
      // Ensure directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, sanitizeContent(content) || '');
    }

    // Auto-commit and push the changes
    try {
      const commitMessage = type === 'directory' 
        ? `Created directory: ${relativePath}` 
        : `Created file: ${relativePath}`;
      await gitManager.commit(repoPath, commitMessage, session.user.email || undefined, session.user.name || undefined);
      
      // Push to GitHub in background (non-blocking)
      if (githubAccessToken) {
        gitManager.pushAsync(repoPath, githubAccessToken);
      }
    } catch (commitErr) {
      console.error('Auto-commit/push error:', commitErr);
      // Don't fail the request if commit/push fails
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error creating file:', error);
    return NextResponse.json({ error: 'Failed to create file' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const body = await request.json();
    const { oldPath, newPath } = body;

    // Rate limiting
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimit = checkRateLimit(identifier, RATE_LIMITS.files);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: createRateLimitHeaders(rateLimit) });
    }

    if (!isValidProjectId(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    if (!isValidFilePath(oldPath) || !isValidFilePath(newPath)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    // Get user and verify project ownership
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

    // Get user's GitHub access token for pushing
    const [user] = await db
      .select({ githubAccessToken: users.githubAccessToken })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    const githubAccessToken = user?.githubAccessToken || undefined;

    // Normalize the repo path for Docker environment
    const repoPath = normalizeRepoPath(project.gitRepoPath);

    // Security: ensure paths don't escape project directory
    const fullOldPath = path.join(repoPath, oldPath);
    const fullNewPath = path.join(repoPath, newPath);
    
    if (!fullOldPath.startsWith(repoPath) || !fullNewPath.startsWith(repoPath)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    await fs.rename(fullOldPath, fullNewPath);

    // Auto-commit and push the rename
    try {
      const commitMessage = `Renamed: ${oldPath} → ${newPath}`;
      await gitManager.commit(repoPath, commitMessage, session.user.email || undefined, session.user.name || undefined);
      
      // Push to GitHub in background (non-blocking)
      if (githubAccessToken) {
        gitManager.pushAsync(repoPath, githubAccessToken);
      }
    } catch (commitErr) {
      console.error('Auto-commit/push error:', commitErr);
      // Don't fail the request if commit/push fails
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error renaming file:', error);
    return NextResponse.json({ error: 'Failed to rename file' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    // Rate limiting
    const identifier = getRateLimitIdentifier(session.user.id);
    const rateLimit = checkRateLimit(identifier, RATE_LIMITS.files);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: createRateLimitHeaders(rateLimit) });
    }

    if (!filePath) {
      return NextResponse.json({ error: 'File path required' }, { status: 400 });
    }

    if (!isValidProjectId(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    if (!isValidFilePath(filePath)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    // Get user and verify project ownership
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

    // Get user's GitHub access token for pushing
    const [user] = await db
      .select({ githubAccessToken: users.githubAccessToken })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    const githubAccessToken = user?.githubAccessToken || undefined;

    // Normalize the repo path for Docker environment
    const repoPath = normalizeRepoPath(project.gitRepoPath);

    // Security: ensure path doesn't escape project directory
    const fullPath = path.join(repoPath, filePath);
    if (!fullPath.startsWith(repoPath)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      await fs.rm(fullPath, { recursive: true });
    } else {
      await fs.unlink(fullPath);
    }

    // Auto-commit and push the deletion
    try {
      const commitMessage = stat.isDirectory() 
        ? `Deleted directory: ${filePath}` 
        : `Deleted file: ${filePath}`;
      await gitManager.commit(repoPath, commitMessage, session.user.email || undefined, session.user.name || undefined);
      
      // Push to GitHub in background (non-blocking)
      if (githubAccessToken) {
        gitManager.pushAsync(repoPath, githubAccessToken);
      }
    } catch (commitErr) {
      console.error('Auto-commit/push error:', commitErr);
      // Don't fail the request if commit/push fails
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 });
  }
}
