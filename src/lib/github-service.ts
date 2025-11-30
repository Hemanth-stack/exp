import path from 'path';
import fs from 'fs/promises';
import simpleGit from 'simple-git';

const REPOS_DIR = path.join(process.cwd(), 'user-repos');

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

export class GitHubService {
  private accessToken: string;
  private username: string;

  constructor(accessToken: string, username: string) {
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

  async createRepository(options: CreateRepoOptions): Promise<GitHubRepo> {
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

    // Set up remote and push
    const git = simpleGit(localRepoPath);
    
    // Check for existing remotes
    const remotes = await git.getRemotes();
    const originRemote = remotes.find(r => r.name === 'origin');

    // Use HTTPS URL with token for authentication
    const remoteUrl = `https://${this.accessToken}@github.com/${this.username}/${repoName}.git`;

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
        // Create and push main branch
        await git.checkoutLocalBranch('main');
        await git.push(['origin', 'main', '--force', '--set-upstream']);
      }
    }

    return repo;
  }

  async syncToGitHub(localRepoPath: string, repoName: string, commitMessage?: string): Promise<void> {
    const git = simpleGit(localRepoPath);

    // Stage all changes
    await git.add('.');

    // Check if there are changes to commit
    const status = await git.status();
    if (status.files.length > 0) {
      await git.commit(commitMessage || `Update from AI App Builder - ${new Date().toISOString()}`);
    }

    // Set up remote URL with token
    const remoteUrl = `https://${this.accessToken}@github.com/${this.username}/${repoName}.git`;
    await git.remote(['set-url', 'origin', remoteUrl]);

    // Push changes
    try {
      await git.push(['origin', 'main']);
    } catch {
      await git.push(['origin', 'master']);
    }
  }

  async cloneFromGitHub(repoName: string, projectId: string): Promise<string> {
    const repoPath = path.join(REPOS_DIR, projectId);
    
    // Create directory
    await fs.mkdir(repoPath, { recursive: true });

    const cloneUrl = `https://${this.accessToken}@github.com/${this.username}/${repoName}.git`;
    const git = simpleGit();
    
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
