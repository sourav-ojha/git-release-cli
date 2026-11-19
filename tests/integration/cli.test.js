import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createFixture } from '../fixtures/repo.js';

const exec = promisify(execFile);
const CLI = path.resolve('src/cli.js');
const FAKE = path.resolve('tests/fixtures/fake-gh');

const cli = (args, { cwd, env } = {}) =>
  exec('node', [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: '1', ...env } }).then(
    (r) => ({ code: 0, ...r }),
    (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }),
  );

function writeConfig(dir, cfg) {
  const file = path.join(dir, 'cfg.json');
  writeFileSync(file, JSON.stringify(cfg));
  return file;
}

describe('release-cli binary', () => {
  it('runs a dry run using an external config from another directory', async () => {
    const fx = createFixture();
    fx.commit('feat: hello');
    fx.pushDev();
    const cfgDir = mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    const cfg = writeConfig(cfgDir, { release: { baseBranch: 'dev', productionBranch: 'main' } });
    const r = await cli(['release', '--config', cfg, '-C', fx.work]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('DRY RUN');
    expect(r.stdout).toContain('Hello');
    expect(fx.git('branch', '--list', 'release/*')).toBe('');
  });

  it('does a real release with --no-dry-run --yes and prints the PR URL', async () => {
    const fx = createFixture();
    fx.commit('fix: hello');
    fx.pushDev();
    const cfg = writeConfig(fx.root, { release: { baseBranch: 'dev', productionBranch: 'main' } });
    const r = await cli(['release', '--config', cfg, '-C', fx.work, '--no-dry-run', '--yes'], {
      env: { PATH: `${FAKE}${path.delimiter}${process.env.PATH}` },
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('https://github.com/acme/widgets/pull/42');
    expect(fx.git('branch', '--list', 'release/*')).toMatch(/release\//);
  });

  it('exits 2 with a clear message on invalid config', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    const cfg = writeConfig(dir, { release: { baseBranch: 'dev', productionBrnach: 'main' } });
    const r = await cli(['release', '--config', cfg]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/productionBrnach|productionBranch/);
  });

  it('requires --config and never falls back to another file', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    writeConfig(dir, {});
    writeFileSync(path.join(dir, 'release.config.json'), '{}');
    const r = await cli(['release'], { cwd: dir });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/--config/);
  });

  it('init refuses to overwrite without confirmation', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'init-'));
    expect((await cli(['init'], { cwd: dir })).code).toBe(0);
    const again = await cli(['init'], { cwd: dir });
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(/already exists|terminal/);
    expect((await cli(['init', '--force'], { cwd: dir })).code).toBe(0);
  });
});
