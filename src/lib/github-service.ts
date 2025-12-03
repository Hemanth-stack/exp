import path from 'path';
import fs from 'fs/promises';
import simpleGit, { SimpleGit } from 'simple-git';

// Use /app/user-repos in Docker, or process.cwd()/user-repos for local dev
const REPOS_DIR = process.env.NODE_ENV === 'production' 
  ? '/app/user-repos'
  : path.join(process.cwd(), 'user-repos');

interface GitHubRepo {
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
}

interface CreateRepoOptions {
  name: string;
  description?: string;
  private?: boolean;
}

/**
 * Validate GitHub username format
 */
function isValidGitHubUsername(username: string): boolean {
  // GitHub usernames: 1-39 alphanumeric or hyphens, cannot start with hyphen
  const usernameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
  return usernameRegex.test(username);
}

/**
 * Validate repository name format
 */
function isValidRepoName(name: string): boolean {
  const repoNameRegex = /^[a-zA-Z0-9._-]{1,100}$/;
  return repoNameRegex.test(name);
}

export class GitHubService {
  private accessToken: string;
  private username: string;

  constructor(accessToken: string, username: string) {
    if (!accessToken || typeof accessToken !== 'string') {
      throw new Error('Invalid access token');
    }
    if (!username || !isValidGitHubUsername(username)) {
      throw new Error('Invalid GitHub username');
    }
    this.accessToken = accessToken;
    this.username = username;
  }

  private async fetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const url = `https://api.github.com${endpoint}`;
    return fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  }

  /**
   * Configure git instance with token authentication
   * Uses environment variables to avoid token in command line
   */
  private async configureGitAuth(git: SimpleGit, repoName: string): Promise<string> {
    // Use HTTPS URL without token embedded
    const remoteUrl = `https://github.com/${this.username}/${repoName}.git`;
    
    // Configure credential helper to use token
    // This prevents the token from being stored in .git/config
    await git.addConfig('credential.helper', 'store', false, 'local');
    
    // Set the remote URL (token will be provided via credential)
    return remoteUrl;
  }

  /**
   * Execute git command with token authentication via environment
   */
  private getAuthenticatedGit(localRepoPath: string): SimpleGit {
    // Use GIT_ASKPASS to provide credentials without storing them
    const git = simpleGit(localRepoPath, {
      config: [
        `http.https://github.com/.extraheader=Authorization: Basic ${Buffer.from(`x-access-token:${this.accessToken}`).toString('base64')}`
      ]
    });
    return git;
  }

  async createRepository(options: CreateRepoOptions): Promise<GitHubRepo> {
    if (!isValidRepoName(options.name)) {
      throw new Error('Invalid repository name');
    }

    const response = await this.fetch('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: options.name,
        description: options.description || 'Created with AI App Builder',
        private: options.private ?? false,
        auto_init: false,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create GitHub repository');
    }

    return response.json();
  }

  async getRepository(name: string): Promise<GitHubRepo | null> {
    if (!isValidRepoName(name)) {
      throw new Error('Invalid repository name');
    }

    const response = await this.fetch(`/repos/${this.username}/${name}`);
    
    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error('Failed to get GitHub repository');
    }

    return response.json();
  }

  async deleteRepository(name: string): Promise<void> {
    if (!isValidRepoName(name)) {
      throw new Error('Invalid repository name');
    }

    const response = await this.fetch(`/repos/${this.username}/${name}`, {
      method: 'DELETE',
    });

    if (!response.ok && response.status !== 404) {
      throw new Error('Failed to delete GitHub repository');
    }
  }

  async pushLocalRepoToGitHub(
    localRepoPath: string,
    repoName: string,
    description?: string
  ): Promise<GitHubRepo> {
    if (!isValidRepoName(repoName)) {
      throw new Error('Invalid repository name');
    }

    // Check if repo exists
    let repo = await this.getRepository(repoName);

    if (!repo) {
      // Create new repository
      repo = await this.createRepository({
        name: repoName,
        description,
        private: false,
      });
    }

    // Use authenticated git instance
    const git = this.getAuthenticatedGit(localRepoPath);
    
    // Check for existing remotes
    const remotes = await git.getRemotes();
    const originRemote = remotes.find(r => r.name === 'origin');

    // Use HTTPS URL - auth is handled via git config
    const remoteUrl = `https://github.com/${this.username}/${repoName}.git`;

    if (originRemote) {
      // Update existing origin
      await git.remote(['set-url', 'origin', remoteUrl]);
    } else {
      // Add new origin
      await git.addRemote('origin', remoteUrl);
    }

    // Ensure we have at least one commit
    try {
      await git.log();
    } catch {
      // No commits yet, create initial commit
      await git.add('.');
      await git.commit('Initial commit');
    }

    // Push to GitHub
    try {
      await git.push(['origin', 'main', '--force']);
    } catch {
      // Try master branch if main fails
      try {
        await git.push(['origin', 'master', '--force']);
      } catch {
        // Ensure we're on main branch and push
        const branches = await git.branchLocal();
        if (!branches.all.includes('main')) {
          // Create main branch only if it doesn't exist
          await git.checkoutLocalBranch('main');
        } else {
          // Just checkout existing main branch
          await git.checkout('main');
        }
        await git.push(['origin', 'main', '--force', '--set-upstream']);
      }
    }

    return repo;
  }

  async syncToGitHub(localRepoPath: string, repoName: string, commitMessage?: string): Promise<void> {
    if (!isValidRepoName(repoName)) {
      throw new Error('Invalid repository name');
    }

    const git = this.getAuthenticatedGit(localRepoPath);

    // Stage all changes
    await git.add('.');

    // Check if there are changes to commit
    const status = await git.status();
    if (status.files.length > 0) {
      // Sanitize commit message
      const safeMessage = commitMessage 
        ? commitMessage.slice(0, 500).replace(/[\x00-\x1F\x7F]/g, '')
        : `Update from AI App Builder - ${new Date().toISOString()}`;
      await git.commit(safeMessage);
    }

    // Set up remote URL (auth via git config)
    const remoteUrl = `https://github.com/${this.username}/${repoName}.git`;
    await git.remote(['set-url', 'origin', remoteUrl]);

    // Push changes
    try {
      await git.push(['origin', 'main']);
    } catch {
      await git.push(['origin', 'master']);
    }
  }

  async cloneFromGitHub(repoName: string, projectId: string): Promise<string> {
    if (!isValidRepoName(repoName)) {
      throw new Error('Invalid repository name');
    }

    // Validate projectId to prevent path traversal
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(projectId)) {
      throw new Error('Invalid project ID');
    }

    const repoPath = path.join(REPOS_DIR, projectId);
    
    // Create directory
    await fs.mkdir(repoPath, { recursive: true });

    // Clone using authenticated git with token in config
    const git = simpleGit({
      config: [
        `http.https://github.com/.extraheader=Authorization: Basic ${Buffer.from(`x-access-token:${this.accessToken}`).toString('base64')}`
      ]
    });
    
    const cloneUrl = `https://github.com/${this.username}/${repoName}.git`;
    await git.clone(cloneUrl, repoPath);

    return repoPath;
  }

  async listRepositories(): Promise<GitHubRepo[]> {
    const response = await this.fetch('/user/repos?sort=updated&per_page=100');

    if (!response.ok) {
      throw new Error('Failed to list repositories');
    }

    return response.json();
  }
}

export function createGitHubService(accessToken: string, username: string): GitHubService {
  return new GitHubService(accessToken, username);
}
