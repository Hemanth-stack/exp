import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs/promises';

const REPOS_DIR = path.join(process.cwd(), 'user-repos');

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

/**
 * Detects project type from package.json or other config files
 */
export async function detectProjectType(repoPath: string): Promise<'nextjs' | 'vite-react' | 'unknown'> {
  try {
    const packageJsonPath = path.join(repoPath, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    // Check for Next.js
    if (deps['next']) {
      return 'nextjs';
    }
    
    // Check for Vite + React
    if (deps['vite'] && (deps['react'] || deps['react-dom'])) {
      return 'vite-react';
    }
    
    // Check for just React (assume Vite-React)
    if (deps['react'] || deps['react-dom']) {
      return 'vite-react';
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
