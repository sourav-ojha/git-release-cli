import { generateChangelog } from '../changelog/generator.js';
import {
  assertValidBranchName, createBranchAt, pushBranch, remoteBranchSha, resolveRefSha, trackingRef,
} from '../git/branches.js';
import { listCommitsInRange, listMessages, resolveCommitHash } from '../git/commits.js';
import { GitClient } from '../git/client.js';
import {
  assertRemoteExists, currentBranch, fetchRemote, isShallowRepository, isWorkingTreeClean, resolveRepositoryRoot,
} from '../git/repository.js';
import { assertCutoffInBase, assertNoProductionRegression, assertProductionIsAncestor } from '../git/validation.js';
import { GitHubClient } from '../github/client.js';
import { ensurePullRequest, renderTitle } from '../github/pull-request.js';
import { createNullLogger } from '../utils/logger.js';
import { ReleaseError, SafetyError, UserAbortError } from '../utils/errors.js';
import { assertBranchAvailable, generateBranchName } from './release-branch.js';
import { buildPullRequestBody, formatFinalSummary, formatPlan } from './release-summary.js';

/**
 * Orchestrates a release. Order mirrors the documented workflow; any failure is tagged with
 * the failing step and, if mutations already happened, with the partial state.
 *
 * @param {object} p
 * @param {object} p.config      validated effective config
 * @param {string} p.cwd         directory inside the target repository
 * @param {string} [p.commit]    optional cutoff hash
 * @param {Function} [p.confirm] async (question) => boolean; required for real runs unless `yes`
 * @param {boolean} [p.yes]      skip the confirmation prompt
 * @param {Date} [p.now]
 */
export async function runRelease({
  config, cwd, commit, logger = createNullLogger(), confirm, yes = false, now = new Date(), runner, github,
}) {
  const dryRun = config.options.dryRun;
  const { remote } = config.git;
  const { baseBranch, productionBranch } = config.release;
  const state = { branchCreated: false, pushed: false, branch: null };
  let step = 'initialize';
  const at = (name) => {
    step = name;
    logger.debug(`step: ${name}`);
  };

  try {
    at('verify repository');
    let git = new GitClient({ cwd, runner, logger });
    const repoRoot = await resolveRepositoryRoot(git);
    git = new GitClient({ cwd: repoRoot, runner, logger });
    const shallow = await isShallowRepository(git);
    const branchNow = await currentBranch(git);
    const notes = [];
    if (!branchNow) notes.push('HEAD is detached. This is fine: the release branch is created without switching branches.');
    if (shallow) notes.push('Repository is shallow; ancestry checks fail closed if they cannot be verified.');

    at('verify working tree');
    if (config.git.requireCleanWorkingTree) {
      const { clean, details } = await isWorkingTreeClean(git);
      if (!clean) {
        throw new SafetyError('Working tree has uncommitted changes.', {
          hint: `Commit or stash them (nothing is discarded), or set git.requireCleanWorkingTree to false.\n${details.split('\n').slice(0, 10).join('\n')}`,
        });
      }
    }

    at('verify binaries and remote');
    await assertRemoteExists(git, remote);
    let gh = github;
    let ghRepo;
    if (config.options.createPullRequest) {
      gh ??= new GitHubClient({ cwd: repoRoot, runner, logger });
      try {
        await gh.assertInstalled();
        await gh.assertAuthenticated();
        if (!dryRun) ghRepo = await gh.resolveRepository();
      } catch (e) {
        if (!dryRun) throw e;
        notes.push(`GitHub CLI check would fail in a real run: ${e.message}`);
      }
    }

    at('fetch remote');
    if (config.git.fetchBeforeRelease && !dryRun) {
      logger.step(`Fetching ${remote}…`);
      await fetchRemote(git, remote);
    } else if (config.git.fetchBeforeRelease) {
      notes.push(`Dry-run does not fetch; using existing ${remote}/* remote-tracking refs, which may be stale.`);
    }

    at('resolve branches');
    await assertValidBranchName(git, baseBranch, 'base branch');
    await assertValidBranchName(git, productionBranch, 'production branch');
    const baseRef = trackingRef(remote, baseBranch);
    const prodRef = trackingRef(remote, productionBranch);
    const baseSha = await resolveRefSha(git, baseRef);
    const productionSha = await resolveRefSha(git, prodRef);
    for (const [name, sha] of [[baseBranch, baseSha], [productionBranch, productionSha]]) {
      if (!sha) {
        throw new SafetyError(`Branch "${name}" was not found on remote "${remote}".`, {
          hint: config.git.fetchBeforeRelease && !dryRun
            ? 'Check the branch name and remote.'
            : `Run "git fetch ${remote}" (or enable git.fetchBeforeRelease) and check the branch name.`,
        });
      }
    }
    for (const [name, sha] of [[baseBranch, baseSha], [productionBranch, productionSha]]) {
      let remoteSha;
      try {
        remoteSha = await remoteBranchSha(git, remote, name);
      } catch (e) {
        if (!dryRun) throw e;
        notes.push(`Could not contact ${remote} to verify "${name}": ${e.message}`);
        continue;
      }
      if (!remoteSha) {
        if (!dryRun) throw new SafetyError(`Branch "${name}" no longer exists on remote "${remote}".`);
        notes.push(`Branch "${name}" is missing on ${remote} (stale tracking ref).`);
      } else if (remoteSha !== sha) {
        const msg = `Local ${remote}/${name} (${sha.slice(0, 12)}) differs from the remote (${remoteSha.slice(0, 12)}).`;
        if (!dryRun) {
          throw new SafetyError(msg, { hint: `Run "git fetch ${remote}" or enable git.fetchBeforeRelease.` });
        }
        notes.push(`${msg} Fetch before a real run.`);
      }
    }

    at('resolve cutoff commit');
    let cutoff;
    let cutoffSource;
    if (commit) {
      cutoff = await resolveCommitHash(git, commit);
      cutoffSource = `explicit --commit ${commit}`;
    } else {
      cutoff = baseSha;
      cutoffSource = `latest of ${remote}/${baseBranch}`;
    }
    logger.step(`Release cutoff: ${cutoff} (${cutoffSource})`);

    at('validate ancestry');
    await assertCutoffInBase(git, { cutoff, baseRef, baseName: baseBranch, shallow });
    const squash = config.release.productionMergeStyle === 'squash';
    let alreadyReleased = new Set();
    if (squash) {
      const check = await assertNoProductionRegression(git, { productionSha, cutoff, productionName: productionBranch, shallow });
      notes.push(...check.warnings);
      alreadyReleased = releasedHeaders(await listMessages(git, check.mergeBase, productionSha));
    } else {
      await assertProductionIsAncestor(git, { productionSha, cutoff, productionName: productionBranch, shallow });
    }

    at('generate release notes');
    let rawCommits = await listCommitsInRange(git, prodRef, cutoff, { includeMerges: config.changelog.includeMerges });
    if (squash) {
      const before = rawCommits.length;
      rawCommits = rawCommits.filter((c) => !alreadyReleased.has(c.message.split('\n')[0].trim()));
      if (before !== rawCommits.length) {
        notes.push(`${before - rawCommits.length} commit(s) already listed in ${productionBranch} squash commits were left out of the notes.`);
      }
    }
    const { markdown } = generateChangelog(rawCommits, { includeAuthors: config.pullRequest.includeCommitAuthors });
    if (rawCommits.length === 0) notes.push(`No commits between ${productionBranch} and the cutoff; there is nothing to release.`);

    at('generate release branch name');
    const branch = generateBranchName(config.release, now);
    state.branch = branch;
    const availability = await assertBranchAvailable(git, remote, branch, { tolerateRemoteFailure: dryRun });
    if (availability.warning) notes.push(availability.warning);

    const title = renderTitle(config.pullRequest.title, { date: now, branch, commit: cutoff.slice(0, 7) });
    const body = buildPullRequestBody({
      branch, base: baseBranch, production: productionBranch, cutoff, commitCount: rawCommits.length, markdown,
    });
    const plan = {
      config, repoRoot, baseSha, productionSha, cutoff, cutoffSource, commitCount: rawCommits.length,
      branch, title, body, dryRun, notes,
    };

    at('display plan');
    logger.plain(formatPlan(plan));
    if (dryRun) {
      logger.plain('');
      logger.success('Dry run complete. Nothing was created, switched, pushed or modified.');
      return { dryRun: true, plan, branch, cutoff, notes: markdown };
    }

    if (rawCommits.length === 0) {
      throw new SafetyError(`Nothing to release: ${productionBranch} already contains the cutoff commit.`, {
        hint: 'Pick a later --commit or wait for new commits on the base branch.',
      });
    }

    at('confirm');
    if (!yes) {
      const ok = await confirm?.(`Create ${branch}${config.options.pushBranch ? ', push it' : ''}${config.options.createPullRequest ? ' and open a pull request' : ''}?`);
      if (!ok) throw new UserAbortError();
    }

    at('create release branch');
    await createBranchAt(git, branch, cutoff);
    state.branchCreated = true;
    if ((await resolveRefSha(git, `refs/heads/${branch}`)) !== cutoff) {
      throw new ReleaseError(`Branch ${branch} was created but does not point at the cutoff ${cutoff}.`);
    }
    logger.success(`Created local branch ${branch} at ${cutoff.slice(0, 12)}`);

    let pullRequest = null;
    if (config.options.pushBranch) {
      at('push release branch');
      await pushBranch(git, remote, branch);
      state.pushed = true;
      logger.success(`Pushed ${branch} to ${remote}`);
    }

    if (config.options.createPullRequest) {
      at('create pull request');
      const pushedSha = await remoteBranchSha(git, remote, branch);
      if (pushedSha !== cutoff) {
        throw new ReleaseError(`Remote branch ${remote}/${branch} is not at the cutoff commit after push.`);
      }
      pullRequest = await ensurePullRequest(
        gh,
        {
          repo: ghRepo, base: productionBranch, head: branch, title, body,
          draft: config.pullRequest.draft, labels: config.pullRequest.labels,
          reviewers: config.pullRequest.reviewers, assignees: config.pullRequest.assignees,
        },
        { logger },
      );
      if (pullRequest.created) logger.success(`Created pull request ${pullRequest.url}`);
      else logger.warn(`An open pull request already exists, none created: ${pullRequest.url}`);
    }

    at('summary');
    logger.plain('');
    logger.plain(formatFinalSummary({ branch, cutoff, commitCount: rawCommits.length, pushed: state.pushed, pullRequest, config }));
    return { dryRun: false, plan, branch, cutoff, pullRequest, pushed: state.pushed };
  } catch (error) {
    throw annotate(error, step, state, config);
  }
}

function annotate(error, step, state, config) {
  const err = error instanceof ReleaseError ? error : new ReleaseError(error.message ?? String(error), { cause: error });
  err.step ??= step;
  if (state.branchCreated) {
    err.partialState.push(`Local branch "${state.branch}" was created and left in place.`);
    if (state.pushed) err.partialState.push(`Branch "${state.branch}" was pushed to "${config.git.remote}" and left in place.`);
    else if (config.options.pushBranch) err.partialState.push('The branch was NOT pushed.');
    err.partialState.push('Nothing was rolled back or deleted. Inspect it, then resume manually or delete the branch yourself.');
  }
  return err;
}

/** Header lines (subjects) mentioned in production-only commits: squash messages list their contents. */
export function releasedHeaders(messages) {
  const set = new Set();
  for (const message of messages) {
    for (const line of message.split('\n')) {
      const t = line.replace(/^\s*[*-]\s+/, '').trim();
      if (t) set.add(t);
    }
  }
  return set;
}
