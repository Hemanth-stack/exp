import simpleGit, { SimpleGit } from 'simple-git';
import path from 'path';
import fs from 'fs/promises';

// Use /app/user-repos in Docker, or process.cwd()/user-repos for local dev
const REPOS_DIR = process.env.NODE_ENV === 'production' 
  ? '/app/user-repos'
  : path.join(process.cwd(), 'user-repos');

// Default git identity for automated commits
const DEFAULT_GIT_EMAIL = 'builder@appbuilder.local';
const DEFAULT_GIT_NAME = 'App Builder';

// Default .gitignore content for projects
const DEFAULT_GITIGNORE = `# Dependencies
node_modules/
.pnp
.pnp.js
.yarn/

# Testing
coverage/

# Next.js
.next/
out/
build/
dist/

# Misc
.DS_Store
*.pem
Thumbs.db

# Debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.npm/
.eslintcache

# Local env files
.env*.local
.env
.env.development
.env.production

# Vercel
.vercel

# TypeScript
*.tsbuildinfo
next-env.d.ts

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS files
.DS_Store
.Spotlight-V100
.Trashes
ehthumbs.db
`;

/**
 * Ensures .gitignore exists in the repository
 * Creates one with defaults if missing
 */
async function ensureGitIgnore(repoPath: string): Promise<boolean> {
  const gitignorePath = path.join(repoPath, '.gitignore');
  
  try {
    await fs.access(gitignorePath);
    // .gitignore exists
    return false;
  } catch {
    // .gitignore doesn't exist, create it
    try {
      await fs.writeFile(gitignorePath, DEFAULT_GITIGNORE, 'utf-8');
      console.log(`[GitManager] Created .gitignore in ${repoPath}`);
      return true;
    } catch (err) {
      console.error('[GitManager] Failed to create .gitignore:', err);
      return false;
    }
  }
}

/**
 * Ensures git identity is configured for a repository
 * This prevents "Author identity unknown" errors in containers
 */
async function ensureGitIdentity(git: SimpleGit, userEmail?: string, userName?: string): Promise<void> {
  const emailToUse = userEmail || DEFAULT_GIT_EMAIL;
  const nameToUse = userName || DEFAULT_GIT_NAME;
  
  try {
    // First check global config
    const globalEmail = await git.getConfig('user.email', 'global').catch(() => null);
    const globalName = await git.getConfig('user.name', 'global').catch(() => null);
    
    // If global config exists, we're good
    if (globalEmail?.value && globalName?.value) {
      return;
    }
    
    // Try to set local config for this repo
    try {
      await git.addConfig('user.email', emailToUse, false, 'local');
      await git.addConfig('user.name', nameToUse, false, 'local');
    } catch {
      // If local config fails (e.g., not a git repo yet), set global
      console.log('[GitManager] Setting global git identity config');
      await git.addConfig('user.email', emailToUse, false, 'global');
      await git.addConfig('user.name', nameToUse, false, 'global');
    }
  } catch (error) {
    // Ultimate fallback: try to set global config
    console.log('[GitManager] Fallback: Setting global git identity config');
    try {
      await git.addConfig('user.email', emailToUse, false, 'global');
      await git.addConfig('user.name', nameToUse, false, 'global');
    } catch (globalError) {
      console.error('[GitManager] Failed to set git identity:', globalError);
    }
  }
}

/**
 * Validates that a repository path is safe and within allowed directories
 * Prevents path traversal attacks
 */
export function validateRepoPath(repoPath: string): boolean {
  // Normalize the path to resolve any .. or . components
  const normalizedPath = path.normalize(repoPath);
  
  // Check for path traversal attempts
  if (normalizedPath.includes('..')) {
    return false;
  }
  
  // Define allowed base directories
  const allowedBases = [
    '/app/user-repos',
    path.join(process.cwd(), 'user-repos'),
  ];
  
  // Check if path starts with an allowed base
  const isWithinAllowed = allowedBases.some(base => 
    normalizedPath.startsWith(path.normalize(base))
  );
  
  if (!isWithinAllowed) {
    return false;
  }
  
  // Additional security: ensure path doesn't contain suspicious patterns
  const suspiciousPatterns = [
    /\0/,           // Null bytes
    /[<>:"|?*]/,    // Windows-restricted characters
    /\/\//,         // Double slashes
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(repoPath)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Normalizes a repository path for the current environment
 * Handles both host paths and container paths
 */
export function normalizeRepoPath(storedPath: string): string {
  // If path is already relative to /app/user-repos, use it directly
  if (storedPath.startsWith('/app/user-repos')) {
    return storedPath;
  }
  
  // If running in production (Docker), extract the project ID and rebuild path
  if (process.env.NODE_ENV === 'production') {
    // Extract project ID from various path formats
    const match = storedPath.match(/user-repos[\/\\]([^\/\\]+)/);
    if (match) {
      return path.join('/app/user-repos', match[1]);
    }
  }
  
  // For local dev, if path doesn't start with REPOS_DIR, try to normalize it
  if (!storedPath.startsWith(REPOS_DIR)) {
    const match = storedPath.match(/user-repos[\/\\]([^\/\\]+)/);
    if (match) {
      return path.join(REPOS_DIR, match[1]);
    }
  }
  
  return storedPath;
}

/**
 * Validates and parses a GitHub URL
 * Supports formats: 
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string; isValid: boolean } {
  const httpsPattern = /^https:\/\/github\.com\/([^\/]+)\/([^\/\.]+)(\.git)?$/;
  const sshPattern = /^git@github\.com:([^\/]+)\/([^\/\.]+)(\.git)?$/;
  
  const match = url.match(httpsPattern) || url.match(sshPattern);
  
  if (match) {
    return {
      owner: match[1],
      repo: match[2],
      isValid: true,
    };
  }
  
  return { owner: '', repo: '', isValid: false };
}

interface GitHubRepoInfo {
  name: string;
  full_name: string;
  description?: string;
  private: boolean;
  default_branch: string;
  language?: string;
  stargazers_count: number;
  html_url: string;
}

/**
 * Checks if a GitHub repository is accessible (public or with token)
 */
export async function validateGitHubRepo(
  url: string, 
  accessToken?: string
): Promise<{ valid: boolean; error?: string; repoInfo?: GitHubRepoInfo }> {
  const parsed = parseGitHubUrl(url);
  
  if (!parsed.isValid) {
    return { valid: false, error: 'Invalid GitHub URL format' };
  }
  
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'AI-App-Builder',
    };
    
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    
    const response = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
      { headers }
    );
    
    if (response.status === 404) {
      return { 
        valid: false, 
        error: 'Repository not found. Make sure it exists and you have access to it.' 
      };
    }
    
    if (response.status === 401 || response.status === 403) {
      return { 
        valid: false, 
        error: 'Private repository. Connect your GitHub account to access it.' 
      };
    }
    
    if (!response.ok) {
      return { valid: false, error: `GitHub API error: ${response.status}` };
    }
    
    const repoInfo = await response.json();
    return { valid: true, repoInfo };
  } catch (error) {
    console.error('Error validating GitHub repo:', error);
    return { valid: false, error: 'Failed to validate repository' };
  }
}

export type ProjectType = 'nextjs' | 'vite-react' | 'vue' | 'angular' | 'svelte' | 'express' | 'python' | 'java' | 'static' | 'unknown';

/**
 * Detects project type from package.json or other config files
 */
export async function detectProjectType(repoPath: string): Promise<ProjectType> {
  // Check for Python project first
  try {
    const requirementsPath = path.join(repoPath, 'requirements.txt');
    await fs.access(requirementsPath);
    
    // Check if there's also a package.json (hybrid project)
    try {
      const packageJsonPath = path.join(repoPath, 'package.json');
      await fs.access(packageJsonPath);
      // Has both - continue to check JS type
    } catch {
      // Only has requirements.txt - it's a Python project
      return 'python';
    }
  } catch {
    // No requirements.txt, continue
  }

  // Check for Java project
  try {
    await fs.access(path.join(repoPath, 'pom.xml'));
    return 'java';
  } catch {
    // Not Maven
  }
  try {
    await fs.access(path.join(repoPath, 'build.gradle'));
    return 'java';
  } catch {
    // Not Gradle
  }

  // Check for static HTML
  try {
    await fs.access(path.join(repoPath, 'index.html'));
    // Check if there's no package.json (pure static)
    try {
      await fs.access(path.join(repoPath, 'package.json'));
      // Has package.json, continue to check JS type
    } catch {
      return 'static';
    }
  } catch {
    // No index.html
  }

  try {
    const packageJsonPath = path.join(repoPath, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    // Check for Next.js
    if (deps['next']) {
      return 'nextjs';
    }

    // Check for Vue
    if (deps['vue']) {
      return 'vue';
    }

    // Check for Angular
    if (deps['@angular/core']) {
      return 'angular';
    }

    // Check for Svelte
    if (deps['svelte']) {
      return 'svelte';
    }
    
    // Check for Vite + React
    if (deps['vite'] && (deps['react'] || deps['react-dom'])) {
      return 'vite-react';
    }
    
    // Check for just React (assume Vite-React)
    if (deps['react'] || deps['react-dom']) {
      return 'vite-react';
    }

    // Check for Express
    if (deps['express']) {
      return 'express';
    }
    
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export class GitManager {
  /**
   * Clone a repository from a GitHub URL
   */
  async cloneRepository(
    projectId: string, 
    githubUrl: string,
    accessToken?: string
  ): Promise<{ repoPath: string; detectedTemplate: string }> {
    const repoPath = path.join(REPOS_DIR, projectId);

    // Ensure directory doesn't exist
    await fs.rm(repoPath, { recursive: true, force: true });
    await fs.mkdir(repoPath, { recursive: true });

    // Prepare clone URL with auth if token provided
    let cloneUrl = githubUrl;
    if (accessToken && githubUrl.startsWith('https://')) {
      // Insert token for authenticated clone
      cloneUrl = githubUrl.replace('https://github.com/', `https://x-access-token:${accessToken}@github.com/`);
    }

    // Clone the repository
    const git = simpleGit();
    try {
      await git.clone(cloneUrl, repoPath, ['--depth', '1']);
      console.log(`[GitManager] Cloned repository to ${repoPath}`);
      
      // Ensure .gitignore exists after clone
      await ensureGitIgnore(repoPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[GitManager] Clone failed:', message);
      await fs.rm(repoPath, { recursive: true, force: true });
      throw new Error(`Failed to clone repository: ${message}`);
    }

    // Detect project type
    const detectedTemplate = await detectProjectType(repoPath);
    console.log(`[GitManager] Detected template: ${detectedTemplate}`);

    return { repoPath, detectedTemplate };
  }

  async initRepository(projectId: string, template: string): Promise<string> {
    const repoPath = path.join(REPOS_DIR, projectId);

    // Create directory
    await fs.mkdir(repoPath, { recursive: true });

    // Copy template
    const templatePath = path.join(process.cwd(), 'templates', template);
    await this.copyTemplate(templatePath, repoPath);

    // Ensure .gitignore exists (in case template doesn't have one)
    await ensureGitIgnore(repoPath);

    // Initialize git with default user config
    const git = simpleGit(repoPath);
    await git.init();
    
    // Ensure git identity is configured
    await ensureGitIdentity(git);
    
    await git.add('.');
    await git.commit('Initial commit');

    return repoPath;
  }

  private async copyTemplate(src: string, dest: string): Promise<void> {
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await fs.mkdir(destPath, { recursive: true });
        await this.copyTemplate(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  async deleteRepository(projectId: string): Promise<void> {
    const repoPath = path.join(REPOS_DIR, projectId);
    await fs.rm(repoPath, { recursive: true, force: true });
  }

  async getLog(repoPath: string, limit: number = 10): Promise<{ hash: string; date: string; message: string; author_name: string }[]> {
    const git = simpleGit(repoPath);
    const log = await git.log({ maxCount: limit });
    return [...log.all];
  }

  async getDiff(repoPath: string, commitSha?: string): Promise<string> {
    const git = simpleGit(repoPath);
    if (commitSha) {
      return await git.diff([`${commitSha}^`, commitSha]);
    }
    return await git.diff();
  }

  async getStatus(repoPath: string): Promise<{ files: { path: string; index: string; working_dir: string }[] }> {
    const git = simpleGit(repoPath);
    return await git.status();
  }

  async commit(repoPath: string, message: string, userEmail?: string, userName?: string): Promise<void> {
    const git = simpleGit(repoPath);
    
    // Ensure .gitignore exists to avoid committing node_modules etc
    await ensureGitIgnore(repoPath);
    
    // Ensure git identity is configured before commit
    await ensureGitIdentity(git, userEmail, userName);
    
    await git.add('.');
    await git.commit(message);
  }

  /**
   * Push changes to remote (GitHub) - optimized for speed
   * @param timeout - max time to wait for push (default 10 seconds)
   */
  async push(repoPath: string, accessToken?: string, repoUrl?: string, timeout: number = 10000): Promise<boolean> {
    const git = simpleGit(repoPath);
    
    try {
      // Quick check if remote exists
      const remotes = await git.getRemotes(false);
      const hasOrigin = remotes.some(r => r.name === 'origin');
      
      if (!hasOrigin && !repoUrl) {
        console.log('[GitManager] No remote configured, skipping push');
        return false;
      }

      // Set up auth URL if token provided
      if (accessToken) {
        let urlToParse = repoUrl;
        if (!urlToParse) {
          const remotesWithRefs = await git.getRemotes(true);
          const origin = remotesWithRefs.find(r => r.name === 'origin');
          urlToParse = origin?.refs?.push;
        }
        
        if (urlToParse) {
          const parsed = parseGitHubUrl(urlToParse);
          if (parsed.isValid) {
            const authUrl = `https://${accessToken}@github.com/${parsed.owner}/${parsed.repo}.git`;
            await git.remote(['set-url', 'origin', authUrl]);
          }
        }
      }

      // Get current branch (fast)
      const branchSummary = await git.branchLocal();
      const currentBranch = branchSummary.current || 'main';

      // Push with timeout
      const pushPromise = git.push(['origin', currentBranch, '--force-with-lease']);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Push timeout')), timeout)
      );

      await Promise.race([pushPromise, timeoutPromise]);
      console.log(`[GitManager] Pushed to ${currentBranch}`);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[GitManager] Push failed:', msg);
      return false;
    }
  }

  /**
   * Push changes in background (fire-and-forget)
   * Returns immediately, push happens asynchronously
   */
  pushAsync(repoPath: string, accessToken?: string, repoUrl?: string): void {
    // Fire and forget - don't await
    this.push(repoPath, accessToken, repoUrl, 30000).then(success => {
      if (success) {
        console.log('[GitManager] Background push completed');
      } else {
        console.log('[GitManager] Background push failed or skipped');
      }
    }).catch(err => {
      console.error('[GitManager] Background push error:', err);
    });
  }

  /**
   * Commit and push changes in one operation
   */
  async commitAndPush(
    repoPath: string, 
    message: string, 
    accessToken?: string, 
    repoUrl?: string,
    userEmail?: string,
    userName?: string
  ): Promise<{ committed: boolean; pushed: boolean }> {
    const git = simpleGit(repoPath);
    
    // Ensure git identity is configured before commit
    await ensureGitIdentity(git, userEmail, userName);
    
    // Check if there are changes
    const status = await git.status();
    if (status.files.length === 0) {
      return { committed: false, pushed: false };
    }

    // Commit
    await git.add('.');
    await git.commit(message);
    
    // Push if credentials available
    const pushed = await this.push(repoPath, accessToken, repoUrl);
    
    return { committed: true, pushed };
  }

  async revertToCommit(repoPath: string, commitSha: string): Promise<void> {
    const git = simpleGit(repoPath);
    await git.reset(['--hard', commitSha]);
  }

  async getBranches(repoPath: string): Promise<string[]> {
    const git = simpleGit(repoPath);
    const branches = await git.branch();
    return branches.all;
  }

  async checkout(repoPath: string, branch: string): Promise<void> {
    const git = simpleGit(repoPath);
    await git.checkout(branch);
  }

  /**
   * Auto-save: commit any pending changes with a timestamp message
   * Used for automatic saves on inactivity or session close
   */
  async autoSave(
    repoPath: string, 
    userEmail?: string, 
    userName?: string
  ): Promise<{ hasChanges: boolean; committed: boolean }> {
    const git = simpleGit(repoPath);
    
    // Ensure .gitignore exists to avoid committing node_modules etc
    await ensureGitIgnore(repoPath);
    
    // Ensure git identity is configured
    await ensureGitIdentity(git, userEmail, userName);
    
    // Check for changes
    const status = await git.status();
    if (status.files.length === 0) {
      return { hasChanges: false, committed: false };
    }

    // Create auto-save commit message
    const timestamp = new Date().toISOString();
    const fileCount = status.files.length;
    const message = `Auto-save: ${fileCount} file(s) updated at ${timestamp}`;

    try {
      await git.add('.');
      await git.commit(message);
      console.log(`[GitManager] Auto-saved ${fileCount} file(s)`);
      return { hasChanges: true, committed: true };
    } catch (error) {
      console.error('[GitManager] Auto-save commit failed:', error);
      return { hasChanges: true, committed: false };
    }
  }

  /**
   * Auto-push: push any unpushed commits to remote
   * Used for automatic push on session close or inactivity timeout
   */
  async autoPush(
    repoPath: string, 
    accessToken?: string, 
    repoUrl?: string
  ): Promise<{ pushed: boolean; commitCount: number }> {
    const git = simpleGit(repoPath);
    
    try {
      // Check if remote exists
      const remotes = await git.getRemotes(true);
      const origin = remotes.find(r => r.name === 'origin');
      
      if (!origin && !repoUrl) {
        return { pushed: false, commitCount: 0 };
      }

      // Count unpushed commits
      let commitCount = 0;
      try {
        const log = await git.log(['origin/main..HEAD']);
        commitCount = log.total;
      } catch {
        // If this fails, there might be no upstream set - try to get all local commits
        try {
          const log = await git.log(['--not', '--remotes']);
          commitCount = log.total;
        } catch {
          // Assume there are commits to push
          commitCount = 1;
        }
      }

      if (commitCount === 0) {
        return { pushed: false, commitCount: 0 };
      }

      // Push
      const pushed = await this.push(repoPath, accessToken, repoUrl);
      console.log(`[GitManager] Auto-pushed ${commitCount} commit(s)`);
      
      return { pushed, commitCount };
    } catch (error) {
      console.error('[GitManager] Auto-push failed:', error);
      return { pushed: false, commitCount: 0 };
    }
  }

  /**
   * Full auto-sync: commit pending changes and push to remote
   * Called on session close or inactivity timeout
   */
  async autoSync(
    repoPath: string, 
    accessToken?: string, 
    repoUrl?: string,
    userEmail?: string,
    userName?: string
  ): Promise<{ committed: boolean; pushed: boolean; fileCount: number }> {
    // First, auto-save any pending changes
    const saveResult = await this.autoSave(repoPath, userEmail, userName);
    
    // Then, push all unpushed commits
    const pushResult = await this.autoPush(repoPath, accessToken, repoUrl);
    
    return {
      committed: saveResult.committed,
      pushed: pushResult.pushed,
      fileCount: saveResult.hasChanges ? (await simpleGit(repoPath).status()).files.length : 0,
    };
  }
}

export const gitManager = new GitManager();
