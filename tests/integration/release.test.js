import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRelease } from '../../src/release/release-manager.js';
import { createFixture, git, makeConfig } from '../fixtures/repo.js';

const NOW = new Date(2026, 10, 19, 10, 30, 0);
const BRANCH = 'release/20261119-103000';

let fx;
beforeEach(() => {
  fx = createFixture();
});

const release = (over = {}, extra = {}) =>
  runRelease({ config: makeConfig(over), cwd: fx.work, now: NOW, yes: true, ...extra });

describe('release branch creation', () => {
  it('creates the branch at an explicit commit and excludes later and production commits', async () => {
    fx.commit('feat(auth): add SSO login');
    const cutoff = fx.commit('fix: handle empty token');
    const later = fx.commit('feat!: change authentication flow');
    fx.pushDev();
    const before = { main: fx.git('rev-parse', 'main'), dev: fx.git('rev-parse', 'dev') };

    const result = await release({}, { commit: cutoff.slice(0, 10) });

    expect(result.branch).toBe(BRANCH);
    expect(fx.git('rev-parse', BRANCH)).toBe(cutoff);
    expect(git(fx.remote, 'rev-parse', `refs/heads/${BRANCH}`)).toBe(cutoff);
    const notes = result.plan.body;
    expect(notes).toContain('**auth:** Add SSO login');
    expect(notes).toContain('Handle empty token');
    expect(notes).not.toContain('authentication flow');
    expect(notes).not.toContain('shipped to production');
    expect(fx.git('merge-base', '--is-ancestor', later, 'dev')).toBe('');
    // base/production untouched, and we never switched branches
    expect(fx.git('rev-parse', 'main')).toBe(before.main);
    expect(fx.git('rev-parse', 'dev')).toBe(before.dev);
    expect(git(fx.remote, 'rev-parse', 'refs/heads/main')).toBe(before.main);
    expect(fx.git('symbolic-ref', '--short', 'HEAD')).toBe('dev');
  });

  it('uses the latest fetched base commit when no commit is given', async () => {
    fx.commit('feat: one');
    const tip = fx.commit('fix: two');
    // push the new commits from a second clone so only fetching reveals them
    fx.pushDev();
    const other = path.join(fx.root, 'other');
    git(fx.root, 'clone', '-q', '-b', 'dev', fx.remote, other);
    const newer = fx.commit('feat: three', other);
    git(other, 'push', '-q', 'origin', 'dev');

    const result = await release();
    expect(result.cutoff).toBe(newer);
    expect(fx.git('rev-parse', BRANCH)).toBe(newer);
    expect(tip).not.toBe(newer);
  });

  it('puts breaking changes in their own section', async () => {
    fx.commit('feat(api)!: change response structure');
    fx.commit('fix: thing\n\nBREAKING CHANGE: tokens now expire');
    fx.pushDev();
    const { plan } = await release({}, {});
    expect(plan.body).toMatch(/## Breaking Changes[\s\S]*\*\*api:\*\* Change response structure/);
    expect(plan.body).toContain('**BREAKING:** tokens now expire');
  });
});

describe('safety validation', () => {
  it('rejects a commit that is not in base history', async () => {
    fx.commit('feat: on dev');
    fx.pushDev();
    fx.git('switch', '-q', '-c', 'side', 'main');
    const stray = fx.commit('feat: side branch only');
    fx.git('push', '-q', 'origin', 'side');
    fx.git('switch', '-q', 'dev');
    await expect(release({}, { commit: stray })).rejects.toThrow(/not in the history of base branch/);
    expect(fx.git('branch', '--list', 'release/*')).toBe('');
  });

  it('rejects a cutoff behind production', async () => {
    fx.commit('feat: on dev');
    fx.pushDev();
    await expect(release({}, { commit: fx.init })).rejects.toThrow(/not an ancestor of the cutoff/);
  });

  it('rejects a base that diverged from production', async () => {
    fx.commit('feat: on dev');
    fx.pushDev();
    fx.git('switch', '-q', 'main');
    fx.commit('fix: hotfix only on main');
    fx.git('push', '-q', 'origin', 'main');
    fx.git('switch', '-q', 'dev');
    const err = await release().catch((e) => e);
    expect(err.message).toMatch(/not an ancestor of the cutoff/);
    expect(err.step).toBe('validate ancestry');
    expect(fx.git('branch', '--list', 'release/*')).toBe('');
  });

  it('rejects an existing local release branch and does not move it', async () => {
    fx.commit('feat: x');
    fx.pushDev();
    fx.git('branch', BRANCH, 'main');
    const before = fx.git('rev-parse', BRANCH);
    await expect(release()).rejects.toThrow(/already exists locally/);
    expect(fx.git('rev-parse', BRANCH)).toBe(before);
  });

  it('rejects an existing remote-only release branch', async () => {
    fx.commit('feat: x');
    fx.pushDev();
    fx.git('push', '-q', 'origin', `main:refs/heads/${BRANCH}`);
    await expect(release()).rejects.toThrow(/already exists on remote/);
  });

  it('rejects a dirty working tree, but allows it when not required', async () => {
    fx.commit('feat: x');
    fx.pushDev();
    writeFileSync(path.join(fx.work, 'dirty.txt'), 'wip');
    await expect(release()).rejects.toThrow(/uncommitted changes/);
    const ok = await release({ git: { requireCleanWorkingTree: false } });
    expect(ok.branch).toBe(BRANCH);
    expect(readFileSync(path.join(fx.work, 'dirty.txt'), 'utf8')).toBe('wip');
  });

  it.each(['not-a-hash', '--all', 'abc', '0'.repeat(40)])('rejects invalid or unknown commit %s', async (bad) => {
    await expect(release({}, { commit: bad })).rejects.toThrow(/Invalid commit hash|does not exist/);
  });

  it('fails closed on a shallow repository', async () => {
    fx.commit('feat: x');
    fx.pushDev();
    const shallow = path.join(fx.root, 'shallow');
    git(fx.root, 'clone', '-q', '--depth', '1', '--no-single-branch', `file://${fx.remote}`, shallow);
    const cfg = makeConfig({ options: { dryRun: true, createPullRequest: false } });
    await expect(runRelease({ config: cfg, cwd: shallow, now: NOW })).rejects.toThrow(/shallow/);
  });
});

describe('empty ranges and dry-run', () => {
  it('previews an empty range but refuses to execute it', async () => {
    const dry = await release({ options: { dryRun: true } });
    expect(dry.plan.commitCount).toBe(0);
    expect(dry.plan.body).toContain('No changes in this release');
    await expect(release()).rejects.toThrow(/Nothing to release/);
    expect(fx.git('branch', '--list', 'release/*')).toBe('');
  });

  it('dry-run mutates nothing (refs, remote, tree, HEAD)', async () => {
    fx.commit('feat: x');
    fx.pushDev();
    const before = fx.snapshot();
    const result = await release({ options: { dryRun: true, createPullRequest: false } });
    expect(result.dryRun).toBe(true);
    expect(fx.snapshot()).toEqual(before);
  });
});

describe('GitHub pull requests (fake gh on PATH)', () => {
  let logFile;
  const originalPath = process.env.PATH;
  const fakeDir = path.resolve('tests/fixtures/fake-gh');

  beforeEach(() => {
    logFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'ghlog-')), 'log.jsonl');
    writeFileSync(logFile, '');
    process.env.PATH = `${fakeDir}${path.delimiter}${originalPath}`;
    process.env.GH_FAKE_LOG = logFile;
  });
  afterEach(() => {
    process.env.PATH = originalPath;
    for (const k of ['GH_FAKE_LOG', 'GH_FAKE_PR_LIST', 'GH_FAKE_AUTH', 'GH_FAKE_CREATE']) delete process.env[k];
  });
  const calls = () => readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const prOpts = { options: { createPullRequest: true }, pullRequest: { draft: true, labels: ['release'], reviewers: ['alice'], assignees: ['bob'], includeCommitAuthors: true } };

  it('creates a PR with the right arguments and body', async () => {
    const tip = fx.commit('feat: big thing');
    fx.pushDev();
    const result = await release(prOpts);
    expect(result.pullRequest).toEqual({ url: 'https://github.com/acme/widgets/pull/42', created: true });
    const create = calls().find((c) => c.args[1] === 'create');
    expect(create.args).toEqual([
      'pr', 'create', '--repo', 'acme/widgets', '--base', 'main', '--head', BRANCH,
      '--title', 'Release: 19 November 2026', '--body-file', expect.any(String),
      '--draft', '--label', 'release', '--reviewer', 'alice', '--assignee', 'bob',
    ]);
    expect(create.body).toContain('## Features');
    expect(create.body).toContain(`Big thing (${tip.slice(0, 7)}) — Test Dev`);
  });

  it('does not create a second PR when an open one exists', async () => {
    fx.commit('feat: big thing');
    fx.pushDev();
    process.env.GH_FAKE_PR_LIST = JSON.stringify([
      { number: 7, url: 'https://github.com/acme/widgets/pull/7', state: 'OPEN', headRefName: BRANCH, baseRefName: 'main' },
    ]);
    const result = await release(prOpts);
    expect(result.pullRequest).toEqual({ url: 'https://github.com/acme/widgets/pull/7', created: false });
    expect(calls().some((c) => c.args[1] === 'create')).toBe(false);
  });

  it('reports partial state when PR creation fails after push', async () => {
    fx.commit('feat: big thing');
    fx.pushDev();
    process.env.GH_FAKE_CREATE = 'fail';
    const err = await release(prOpts).catch((e) => e);
    expect(err.step).toBe('create pull request');
    expect(err.partialState.join('\n')).toMatch(/created and left in place/);
    expect(err.partialState.join('\n')).toMatch(/pushed to "origin"/);
    expect(fx.git('rev-parse', '--verify', BRANCH)).toBeTruthy();
  });

  it('stops before any mutation when gh is not authenticated', async () => {
    fx.commit('feat: big thing');
    fx.pushDev();
    process.env.GH_FAKE_AUTH = 'fail';
    await expect(release(prOpts)).rejects.toThrow(/not authenticated/);
    expect(fx.git('branch', '--list', 'release/*')).toBe('');
  });

  it('dry-run never calls pr create', async () => {
    fx.commit('feat: big thing');
    fx.pushDev();
    const result = await release({ ...prOpts, options: { dryRun: true, createPullRequest: true } });
    expect(result.dryRun).toBe(true);
    expect(calls().some((c) => c.args[0] === 'pr' && c.args[1] === 'create')).toBe(false);
    expect(fx.git('branch', '--list', 'release/*')).toBe('');
  });
});

describe('squash-merged production (productionMergeStyle: squash)', () => {
  const squashCfg = { release: { productionMergeStyle: 'squash' } };

  // Simulate a squash release: main gets ONE new commit whose body lists dev's commits.
  function squashReleaseOfDev(subjects) {
    fx.git('switch', '-q', 'main');
    fx.git('merge', '--squash', 'dev');
    fx.git('commit', '-q', '-m', `release: first\n\n${subjects.map((s) => `* ${s}`).join('\n')}`);
    fx.git('push', '-q', 'origin', 'main');
    fx.git('switch', '-q', 'dev');
  }

  it('strict mode rejects, squash mode accepts and omits already-released commits', async () => {
    fx.commit('feat: released one');
    fx.commit('fix: released two');
    fx.pushDev();
    squashReleaseOfDev(['feat: released one', 'fix: released two']);
    fx.commit('feat: brand new');
    fx.pushDev();

    const strict = await release({ options: { dryRun: true } }).catch((e) => e);
    expect(strict.message).toMatch(/not an ancestor/);
    expect(strict.hint).toMatch(/productionMergeStyle/);
    const result = await release({ ...squashCfg });
    expect(result.plan.commitCount).toBe(1);
    expect(result.plan.body).toContain('Brand new');
    expect(result.plan.body).not.toContain('Released one');
    expect(fx.git('rev-parse', BRANCH)).toBe(result.cutoff);
  });

  it('rejects when the release would revert a production-only change', async () => {
    fx.commit('feat: on dev');
    fx.pushDev();
    fx.git('switch', '-q', 'main');
    fx.commit('fix: hotfix only on main');
    fx.git('push', '-q', 'origin', 'main');
    fx.git('switch', '-q', 'dev');
    await expect(release({ ...squashCfg })).rejects.toThrow(/revert 1 change/);
    expect(fx.git('branch', '--list', 'release/*')).toBe('');
  });
});
