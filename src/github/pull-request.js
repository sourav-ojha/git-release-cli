import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitHubError } from '../utils/errors.js';
import { formatLongDate } from '../utils/date.js';

/** Replace {date}, {branch}, {commit}. Unknown placeholders are rejected by the config schema. */
export function renderTitle(template, { date, branch, commit }) {
  const values = { date: formatLongDate(date), branch, commit };
  return template.replace(/\{(date|branch|commit)\}/g, (_m, key) => values[key]);
}

/** Build `gh pr create` arguments (pure; no shell strings). */
export function buildCreateArgs({ repo, base, head, title, bodyFile, draft, labels = [], reviewers = [], assignees = [] }) {
  const args = ['pr', 'create'];
  if (repo) args.push('--repo', repo);
  args.push('--base', base, '--head', head, '--title', title, '--body-file', bodyFile);
  if (draft) args.push('--draft');
  for (const l of labels) args.push('--label', l);
  for (const r of reviewers) args.push('--reviewer', r);
  for (const a of assignees) args.push('--assignee', a);
  return args;
}

/**
 * Find PRs with this head/base in any state.
 * @returns {Promise<{number:number,url:string,state:string}[]>}
 */
export async function findPullRequests(gh, { repo, base, head }) {
  const args = ['pr', 'list'];
  if (repo) args.push('--repo', repo);
  args.push('--head', head, '--base', base, '--state', 'all', '--json', 'number,url,state,headRefName,baseRefName', '--limit', '20');
  const out = await gh.exec(args);
  let list;
  try {
    list = JSON.parse(out || '[]');
  } catch (cause) {
    throw new GitHubError('Could not parse "gh pr list" output.', { cause });
  }
  return list.filter((pr) => pr.headRefName === head && pr.baseRefName === base);
}

/**
 * Create a PR unless an open one exists.
 * - open PR: reused, nothing created
 * - merged PR for this head: refuse
 * - closed PR: warn, create a new one
 * @returns {Promise<{url:string, created:boolean}>}
 */
export async function ensurePullRequest(gh, params, { logger } = {}) {
  const { repo, base, head, body } = params;
  const existing = await findPullRequests(gh, { repo, base, head });
  const open = existing.find((pr) => pr.state === 'OPEN');
  if (open) return { url: open.url, created: false };
  const merged = existing.find((pr) => pr.state === 'MERGED');
  if (merged) {
    throw new GitHubError(`Branch ${head} already has a merged pull request: ${merged.url}`, {
      hint: 'Release branches are single-use. Re-run to generate a new release branch.',
    });
  }
  if (existing.length) logger?.warn(`A closed pull request exists for ${head} -> ${base} (${existing[0].url}); creating a new one.`);

  const dir = await mkdtemp(path.join(os.tmpdir(), 'release-cli-'));
  const bodyFile = path.join(dir, 'release-notes.md');
  try {
    await writeFile(bodyFile, body, { mode: 0o600, flag: 'wx' });
    const out = await gh.exec(buildCreateArgs({ ...params, bodyFile }));
    const url = out.split('\n').map((l) => l.trim()).filter(Boolean).pop();
    if (!url || !/^https?:\/\//.test(url)) {
      throw new GitHubError(`"gh pr create" did not return a pull request URL (output: ${out || 'empty'}).`);
    }
    return { url, created: true };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
