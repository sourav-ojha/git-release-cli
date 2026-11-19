import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateConfig } from '../../src/config/loader.js';

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test Dev', GIT_AUTHOR_EMAIL: 'dev@example.test',
  GIT_COMMITTER_NAME: 'Test Dev', GIT_COMMITTER_EMAIL: 'dev@example.test',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
};

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Isolated fixture: bare "remote" + working clone.
 *   main: init -> shipped        dev: main + whatever tests add
 * Working copy is left on `dev`.
 */
export function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'release-cli-test-'));
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  git(root, 'init', '--bare', '-b', 'main', remote);
  git(root, 'init', '-b', 'main', work);
  git(work, 'remote', 'add', 'origin', remote);

  let n = 0;
  const commit = (message, cwd = work) => {
    n += 1;
    writeFileSync(path.join(cwd, `file-${n}.txt`), `${n}\n`);
    git(cwd, 'add', '.');
    git(cwd, 'commit', '-q', '-m', message);
    return git(cwd, 'rev-parse', 'HEAD');
  };

  const init = commit('chore: init');
  const shipped = commit('feat: shipped to production');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'switch', '-q', '-c', 'dev');
  git(work, 'push', '-q', 'origin', 'dev');

  return {
    root, remote, work, init, shipped, commit,
    git: (...a) => git(work, ...a),
    pushDev: () => git(work, 'push', '-q', 'origin', 'dev'),
    snapshot: () => ({
      local: git(work, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes'),
      remote: git(remote, 'for-each-ref', '--format=%(refname) %(objectname)'),
      status: git(work, 'status', '--porcelain'),
      head: git(work, 'symbolic-ref', 'HEAD'),
    }),
  };
}

export function makeConfig(overrides = {}) {
  const base = {
    release: { baseBranch: 'dev', productionBranch: 'main' },
    options: { dryRun: false, pushBranch: true, createPullRequest: false },
  };
  const merged = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(overrides)])) {
    merged[key] = { ...base[key], ...overrides[key] };
  }
  return validateConfig(merged);
}
