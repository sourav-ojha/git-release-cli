import { SafetyError } from '../utils/errors.js';
import { changedBlobs, isAncestor, mergeBase } from './commits.js';

const SHALLOW_HINT =
  'This repository is shallow, so ancestry cannot be verified reliably. Run "git fetch --unshallow" and retry.';

/** The cutoff must be part of the base branch history. */
export async function assertCutoffInBase(git, { cutoff, baseRef, baseName, shallow }) {
  if (await isAncestor(git, cutoff, baseRef)) return;
  if (shallow) {
    throw new SafetyError(`Cannot verify that ${cutoff.slice(0, 12)} belongs to "${baseName}" (shallow repository).`, {
      hint: SHALLOW_HINT,
    });
  }
  throw new SafetyError(`Commit ${cutoff.slice(0, 12)} is not in the history of base branch "${baseName}".`, {
    hint: 'Choose a commit reachable from the base branch, or omit --commit to use its latest commit.',
  });
}

/**
 * Production must be an ancestor of the cutoff; otherwise the PR would drop
 * production-only commits.
 */
export async function assertProductionIsAncestor(git, { productionSha, cutoff, productionName, shallow }) {
  if (await isAncestor(git, productionSha, cutoff)) return;
  if (shallow) {
    throw new SafetyError(
      `Cannot verify that "${productionName}" is contained in the release cutoff (shallow repository).`,
      { hint: SHALLOW_HINT },
    );
  }
  throw new SafetyError(
    `Production branch "${productionName}" (${productionSha.slice(0, 12)}) is not an ancestor of the cutoff ${cutoff.slice(0, 12)}.`,
    {
      hint:
        'Production has commits the release would not include (cutoff is older than production, or histories diverged). ' +
        'Merge or back-port production into the base branch first, or pick a later cutoff. No branch was created. ' +
        'If production is squash-merged (so it can never be an ancestor), set release.productionMergeStyle to "squash".',
    },
  );
}

/**
 * Squash-merge workflows: production is never an ancestor of the base branch, so ancestry is
 * replaced by a content check. Every path changed on production since the merge-base must either
 * carry the same content on the cutoff, or have been modified on the cutoff too (reported as a
 * warning). A path the cutoff left untouched would be reverted by the release PR -> abort.
 * @returns {Promise<{mergeBase: string, warnings: string[]}>}
 */
export async function assertNoProductionRegression(git, { productionSha, cutoff, productionName, shallow }) {
  let base;
  try {
    base = await mergeBase(git, productionSha, cutoff);
  } catch (e) {
    if (shallow) throw new SafetyError('Cannot find a common ancestor (shallow repository).', { hint: SHALLOW_HINT });
    throw e;
  }
  const prodChanges = await changedBlobs(git, base, productionSha);
  const cutoffChanges = await changedBlobs(git, base, cutoff);
  const reverted = [];
  const diverged = [];
  for (const [file, blob] of prodChanges) {
    if (!cutoffChanges.has(file)) reverted.push(file);
    else if (cutoffChanges.get(file) !== blob) diverged.push(file);
  }
  if (reverted.length) {
    const list = reverted.slice(0, 15).map((f) => `  ${f}`).join('\n');
    throw new SafetyError(
      `Release would revert ${reverted.length} change(s) that exist only on "${productionName}":\n${list}${reverted.length > 15 ? '\n  …' : ''}`,
      { hint: `Back-port these production changes into the base branch (or choose another cutoff) first. No branch was created.` },
    );
  }
  const warnings = diverged.length
    ? [`${diverged.length} file(s) changed on both "${productionName}" and the cutoff with different content (squash history); review the PR diff: ${diverged.slice(0, 5).join(', ')}${diverged.length > 5 ? ', …' : ''}`]
    : [];
  return { mergeBase: base, warnings };
}
