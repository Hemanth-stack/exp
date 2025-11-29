import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs/promises';

const REPOS_DIR = path.join(process.cwd(), 'user-repos');

export class GitManager {
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

  async getLog(repoPath: string, limit: number = 10): Promise<any[]> {
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

  async getStatus(repoPath: string): Promise<any> {
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
