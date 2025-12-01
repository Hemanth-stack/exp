import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs/promises';

// Use /app/user-repos in Docker, or process.cwd()/user-repos for local dev
const REPOS_DIR = process.env.NODE_ENV === 'production' 
  ? '/app/user-repos'
  : path.join(process.cwd(), 'user-repos');

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

    // Initialize git
    const git = simpleGit(repoPath);
    await git.init();
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

  async commit(repoPath: string, message: string): Promise<void> {
    const git = simpleGit(repoPath);
    await git.add('.');
    await git.commit(message);
  }

  /**
   * Push changes to remote (GitHub)
   */
  async push(repoPath: string, accessToken?: string, repoUrl?: string): Promise<boolean> {
    const git = simpleGit(repoPath);
    
    try {
      // Check if remote exists
      const remotes = await git.getRemotes(true);
      const origin = remotes.find(r => r.name === 'origin');
      
      if (!origin) {
        console.log('[GitManager] No remote configured, skipping push');
        return false;
      }

      // Get the current remote URL if repoUrl not provided
      let remoteUrlToUse = repoUrl;
      if (!remoteUrlToUse && origin.refs?.push) {
        remoteUrlToUse = origin.refs.push;
        console.log('[GitManager] Using existing remote URL:', remoteUrlToUse);
      }

      // If accessToken provided, update remote URL with auth
      if (accessToken && remoteUrlToUse) {
        const parsed = parseGitHubUrl(remoteUrlToUse);
        if (parsed.isValid) {
          const authUrl = `https://${accessToken}@github.com/${parsed.owner}/${parsed.repo}.git`;
          await git.remote(['set-url', 'origin', authUrl]);
          console.log('[GitManager] Updated remote URL with auth token');
        }
      } else if (accessToken && origin.refs?.push) {
        // Try to parse from existing origin URL
        const existingUrl = origin.refs.push;
        const parsed = parseGitHubUrl(existingUrl);
        if (parsed.isValid) {
          const authUrl = `https://${accessToken}@github.com/${parsed.owner}/${parsed.repo}.git`;
          await git.remote(['set-url', 'origin', authUrl]);
          console.log('[GitManager] Updated remote URL with auth token from existing origin');
        }
      }

      // Get current branch
      const branchInfo = await git.branch();
      const currentBranch = branchInfo.current || 'main';

      // Push to remote
      try {
        await git.push(['origin', currentBranch]);
        console.log(`[GitManager] Pushed changes to remote (${currentBranch})`);
        return true;
      } catch {
        console.log('[GitManager] Push to current branch failed, trying alternatives...');
        // Try pushing to main or master
        try {
          await git.push(['origin', 'main']);
          return true;
        } catch {
          try {
            await git.push(['origin', 'master']);
            return true;
          } catch (finalErr) {
            console.error('[GitManager] All push attempts failed:', finalErr);
            return false;
          }
        }
      }
    } catch (error) {
      console.error('[GitManager] Push failed:', error);
      return false;
    }
  }

  /**
   * Commit and push changes in one operation
   */
  async commitAndPush(
    repoPath: string, 
    message: string, 
    accessToken?: string, 
    repoUrl?: string
  ): Promise<{ committed: boolean; pushed: boolean }> {
    const git = simpleGit(repoPath);
    
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
}

export const gitManager = new GitManager();
