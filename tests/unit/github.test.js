import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { buildCreateArgs, ensurePullRequest, findPullRequests, renderTitle } from '../../src/github/pull-request.js';
import { GitHubClient } from '../../src/github/client.js';
import { run } from '../../src/utils/command-runner.js';

describe('renderTitle', () => {
  const ctx = { date: new Date(2026, 10, 19), branch: 'release/20261119-103000', commit: 'abc1234' };
  it('replaces all placeholders', () => {
    expect(renderTitle('Release: {date}', ctx)).toBe('Release: 19 November 2026');
    expect(renderTitle('{branch} @ {commit} ({date}) {branch}', ctx)).toBe('release/20261119-103000 @ abc1234 (19 November 2026) release/20261119-103000');
  });
  it('leaves text without placeholders alone', () => expect(renderTitle('Weekly', ctx)).toBe('Weekly'));
});

describe('buildCreateArgs', () => {
  it('builds an argument array (no shell string) with all options', () => {
    const args = buildCreateArgs({
      repo: 'o/r', base: 'main', head: 'release/x', title: 'T "quoted" $(rm -rf /)', bodyFile: '/tmp/b.md',
      draft: true, labels: ['a', 'b'], reviewers: ['r1'], assignees: ['u1'],
    });
    expect(args).toEqual([
      'pr', 'create', '--repo', 'o/r', '--base', 'main', '--head', 'release/x', '--title', 'T "quoted" $(rm -rf /)',
      '--body-file', '/tmp/b.md', '--draft', '--label', 'a', '--label', 'b', '--reviewer', 'r1', '--assignee', 'u1',
    ]);
  });
  it('omits optional flags', () => {
    expect(buildCreateArgs({ base: 'main', head: 'h', title: 't', bodyFile: 'f' })).toEqual([
      'pr', 'create', '--base', 'main', '--head', 'h', '--title', 't', '--body-file', 'f',
    ]);
  });
});

const fakeGh = (responses) => ({ exec: vi.fn(async (args) => responses(args)) });
const pr = (state, over = {}) => ({ number: 1, url: 'https://x/pull/1', state, headRefName: 'h', baseRefName: 'main', ...over });
const params = { repo: 'o/r', base: 'main', head: 'h', title: 't', body: 'BODY' };

describe('duplicate PR detection', () => {
  it('reuses an open PR and creates nothing', async () => {
    const gh = fakeGh(() => JSON.stringify([pr('OPEN')]));
    expect(await ensurePullRequest(gh, params)).toEqual({ url: 'https://x/pull/1', created: false });
    expect(gh.exec).toHaveBeenCalledTimes(1);
  });
  it('refuses when a merged PR exists', async () => {
    const gh = fakeGh(() => JSON.stringify([pr('MERGED')]));
    await expect(ensurePullRequest(gh, params)).rejects.toThrow(/already has a merged pull request/);
  });
  it('warns and creates when only a closed PR exists; body is passed via file', async () => {
    const warn = vi.fn();
    let bodyOnDisk;
    const gh = fakeGh(async (args) => {
      if (args[1] === 'list') return JSON.stringify([pr('CLOSED')]);
      bodyOnDisk = await readFile(args[args.indexOf('--body-file') + 1], 'utf8');
      return 'warning\nhttps://x/pull/9\n';
    });
    expect(await ensurePullRequest(gh, params, { logger: { warn } })).toEqual({ url: 'https://x/pull/9', created: true });
    expect(warn).toHaveBeenCalled();
    expect(bodyOnDisk).toBe('BODY');
  });
  it('removes the temp body file even when creation fails', async () => {
    let file;
    const gh = fakeGh((args) => {
      if (args[1] === 'list') return '[]';
      file = args[args.indexOf('--body-file') + 1];
      throw new Error('boom');
    });
    await expect(ensurePullRequest(gh, params)).rejects.toThrow('boom');
    await expect(readFile(file)).rejects.toThrow(/ENOENT/);
  });
  it('rejects output without a URL', async () => {
    const gh = fakeGh((a) => (a[1] === 'list' ? '[]' : 'created!'));
    await expect(ensurePullRequest(gh, params)).rejects.toThrow(/did not return a pull request URL/);
  });
  it('ignores PRs for other heads/bases', async () => {
    const gh = fakeGh(() => JSON.stringify([pr('OPEN', { headRefName: 'other' })]));
    expect(await findPullRequests(gh, params)).toEqual([]);
  });
});

describe('GitHubClient', () => {
  it('reports a missing gh binary with install hint', async () => {
    const c = new GitHubClient({ runner: (cmd, a, o) => run('definitely-not-gh-binary', a, o) });
    const err = await c.assertInstalled().catch((e) => e);
    expect(err.message).toMatch(/not found on PATH/);
    expect(err.hint).toMatch(/cli\.github\.com/);
  });
  it('reports unauthenticated state', async () => {
    const c = new GitHubClient({ runner: async () => ({ code: 1, stdout: '', stderr: 'nope' }) });
    await expect(c.assertAuthenticated()).rejects.toThrow(/not authenticated/);
  });
});
