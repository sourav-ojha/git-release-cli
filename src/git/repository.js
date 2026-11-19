import { GitError, ReleaseError } from '../utils/errors.js';

export async function resolveRepositoryRoot(git) {
  const result = await git.tryExec(['rev-parse', '--show-toplevel']);
  if (result.code !== 0) {
    throw new GitError(`Not a Git repository: ${git.cwd}`, {
      hint: 'Run from inside the target repository or pass --cwd <path>.',
    });
  }
  return result.stdout.trim();
}

export async function isShallowRepository(git) {
  return (await git.exec(['rev-parse', '--is-shallow-repository'])) === 'true';
}

/** @returns {Promise<string|null>} branch name, or null when HEAD is detached */
export async function currentBranch(git) {
  const result = await git.tryExec(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return result.code === 0 ? result.stdout.trim() : null;
}

export async function isWorkingTreeClean(git) {
  const out = await git.exec(['status', '--porcelain', '--untracked-files=normal']);
  return { clean: out === '', details: out };
}

export async function assertRemoteExists(git, remote) {
  const result = await git.tryExec(['remote', 'get-url', remote]);
  if (result.code !== 0) {
    throw new GitError(`Git remote "${remote}" is not configured in this repository.`, {
      hint: 'Check git.remote in your configuration (see "git remote -v").',
    });
  }
}

export async function fetchRemote(git, remote) {
  const result = await git.tryExec(['fetch', '--quiet', remote], { timeout: 300_000 });
  if (result.code !== 0) {
    throw new ReleaseError(`git fetch ${remote} failed: ${result.stderr.trim() || `exit ${result.code}`}`, {
      hint: 'Check network access and credentials for the remote, or set git.fetchBeforeRelease to false.',
    });
  }
}
