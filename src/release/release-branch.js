import { SafetyError } from '../utils/errors.js';
import { formatTimestamp } from '../utils/date.js';
import { assertValidBranchName, localBranchExists, remoteBranchSha } from '../git/branches.js';

export function generateBranchName({ branchPrefix, branchTimestampFormat }, date) {
  return `${branchPrefix}/${formatTimestamp(date, branchTimestampFormat)}`;
}

/**
 * Fail when the release branch already exists locally or on the remote.
 * `tolerateRemoteFailure` (dry-run) downgrades an unreachable remote to a warning.
 * @returns {Promise<{warning?: string}>}
 */
export async function assertBranchAvailable(git, remote, name, { tolerateRemoteFailure = false } = {}) {
  await assertValidBranchName(git, name, 'release branch');
  if (await localBranchExists(git, name)) {
    throw new SafetyError(`Release branch "${name}" already exists locally. It will not be overwritten.`, {
      hint: 'Wait a second for a new timestamp, or change release.branchPrefix / branchTimestampFormat.',
    });
  }
  let sha;
  try {
    sha = await remoteBranchSha(git, remote, name);
  } catch (e) {
    if (!tolerateRemoteFailure) throw e;
    return { warning: `Could not verify that "${name}" is free on ${remote}: ${e.message}` };
  }
  if (sha) {
    throw new SafetyError(`Release branch "${name}" already exists on remote "${remote}". It will not be overwritten.`);
  }
  return {};
}
