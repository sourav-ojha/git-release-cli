import { GitError } from '../utils/errors.js';

export const trackingRef = (remote, branch) => `refs/remotes/${remote}/${branch}`;
export const headRef = (branch) => `refs/heads/${branch}`;

export async function assertValidBranchName(git, name, label = 'branch') {
  if (typeof name !== 'string' || name.startsWith('-') || name.includes('@{')) {
    throw new GitError(`Invalid ${label} name: ${JSON.stringify(name)}`);
  }
  const result = await git.tryExec(['check-ref-format', headRef(name)]);
  if (result.code !== 0) {
    throw new GitError(`Invalid ${label} name: ${JSON.stringify(name)}`, {
      hint: 'See "git check-ref-format --help" for naming rules.',
    });
  }
}

export async function localBranchExists(git, name) {
  const r = await git.tryExec(['show-ref', '--verify', '--quiet', headRef(name)]);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new GitError(`git show-ref failed: ${r.stderr.trim()}`);
}

/** Resolve a ref to a full commit SHA, or null when it does not exist. */
export async function resolveRefSha(git, ref) {
  const r = await git.tryExec(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * Ask the remote (read-only) for a branch tip.
 * @returns {Promise<string|null>} SHA, or null when the branch is absent on the remote
 */
export async function remoteBranchSha(git, remote, branch) {
  const r = await git.tryExec(['ls-remote', '--exit-code', '--heads', remote, headRef(branch)], { timeout: 60_000 });
  if (r.code === 2) return null;
  if (r.code !== 0) {
    throw new GitError(`Could not query remote "${remote}": ${r.stderr.trim() || `exit ${r.code}`}`, {
      hint: 'Check network access and credentials for the remote.',
    });
  }
  const line = r.stdout.split('\n').find((l) => l.trim().endsWith(`\t${headRef(branch)}`) || l.trim().endsWith(` ${headRef(branch)}`));
  return line ? line.split(/\s+/)[0] : null;
}

/** Create a local branch at an exact commit WITHOUT switching to it. */
export async function createBranchAt(git, name, sha) {
  await git.exec(['branch', '--no-track', name, sha]);
}

/** Push a new branch. Never forces; a non-fast-forward is rejected by git. */
export async function pushBranch(git, remote, name) {
  await git.exec(['push', '--set-upstream', remote, `${headRef(name)}:${headRef(name)}`], { timeout: 300_000 });
}
