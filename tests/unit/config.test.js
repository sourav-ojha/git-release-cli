import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { STARTER_CONFIG } from '../../src/config/defaults.js';
import { applyOverrides, loadConfig, validateConfig } from '../../src/config/loader.js';
import { configSchema } from '../../src/config/schema.js';
import { overridesFromOptions } from '../../src/commands/release.js';

const minimal = { release: { baseBranch: 'dev', productionBranch: 'main' } };

describe('config defaults and validation', () => {
  it('applies defaults (dry-run on by default)', () => {
    const c = validateConfig(minimal);
    expect(c.release.branchPrefix).toBe('release');
    expect(c.release.branchTimestampFormat).toBe('YYYYMMDD-HHmmss');
    expect(c.git).toEqual({ remote: 'origin', fetchBeforeRelease: true, requireCleanWorkingTree: true });
    expect(c.pullRequest.title).toBe('Release: {date}');
    expect(c.options).toEqual({ dryRun: true, pushBranch: true, createPullRequest: true });
  });

  it('requires branch names (no hardcoded project assumptions)', () => {
    expect(() => validateConfig({})).toThrow(/release/);
    expect(() => validateConfig({ release: { baseBranch: 'dev' } })).toThrow(/productionBranch/);
  });

  it('rejects unknown properties at every level', () => {
    expect(() => validateConfig({ ...minimal, extra: 1 })).toThrow(/Unrecognized key/);
    expect(() => validateConfig({ release: { ...minimal.release, baseBrnch: 'x' } })).toThrow(/baseBrnch/);
    expect(() => validateConfig({ ...minimal, git: { token: 'ghp_x' } })).toThrow(/token/);
  });

  it.each([
    [{ release: { baseBranch: '-evil', productionBranch: 'main' } }, /baseBranch/],
    [{ release: { baseBranch: 'a b', productionBranch: 'main' } }, /baseBranch/],
    [{ release: { baseBranch: 'a..b', productionBranch: 'main' } }, /baseBranch/],
    [{ release: { baseBranch: 'main', productionBranch: 'main' } }, /must differ/],
    [{ release: { ...minimal.release, branchTimestampFormat: 'YYYY' } }, /MM and DD/],
    [{ release: { ...minimal.release, branchTimestampFormat: 'YYYYMMDD $(x)' } }, /tokens/],
    [{ ...minimal, pullRequest: { title: 'Release {nope}' } }, /unknown placeholder \{nope\}/],
    [{ ...minimal, options: { pushBranch: false } }, /pushBranch/],
    [{ ...minimal, git: { remote: 'o;rm' } }, /remote/],
  ])('rejects bad config %#', (cfg, re) => {
    expect(() => validateConfig(cfg)).toThrow(re);
  });

  it('reports validation errors with property paths', () => {
    expect(() => validateConfig({ ...minimal, pullRequest: { draft: 'yes' } })).toThrow(/pullRequest\.draft/);
  });
});

describe('CLI overrides', () => {
  it('override config values and re-validate', () => {
    const raw = { ...minimal, options: { dryRun: true } };
    const c = validateConfig(applyOverrides(raw, { baseBranch: 'develop', productionBranch: 'prod', dryRun: false }));
    expect(c.release).toMatchObject({ baseBranch: 'develop', productionBranch: 'prod' });
    expect(c.options.dryRun).toBe(false);
  });
  it('ignores undefined overrides and does not mutate input', () => {
    const raw = structuredClone(minimal);
    const merged = applyOverrides(raw, { baseBranch: undefined });
    expect(merged).toEqual(minimal);
    expect(raw).toEqual(minimal);
  });
  it('--no-push implies no PR unless set explicitly', () => {
    expect(validateConfig(applyOverrides(minimal, { pushBranch: false })).options.createPullRequest).toBe(false);
    expect(() => validateConfig(applyOverrides(minimal, { pushBranch: false, createPullRequest: true }))).toThrow(/pushBranch/);
  });
  it('commander defaults are not treated as overrides', () => {
    const opts = { push: true, pr: true, dryRun: undefined };
    expect(overridesFromOptions(opts, () => 'default')).toEqual({
      baseBranch: undefined, productionBranch: undefined, dryRun: undefined, pushBranch: undefined, createPullRequest: undefined,
    });
    expect(overridesFromOptions({ push: false }, (k) => (k === 'push' ? 'cli' : 'default')).pushBranch).toBe(false);
  });
});

describe('loadConfig', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cfgtest-'));
  const write = (name, data) => {
    const p = path.join(dir, name);
    writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data));
    return p;
  };

  it('loads absolute paths', async () => {
    const p = write('abs.json', minimal);
    expect((await loadConfig(p, { cwd: '/' })).config.release.baseBranch).toBe('dev');
  });
  it('resolves relative paths from the invocation cwd', async () => {
    write('rel.json', minimal);
    const { path: resolved } = await loadConfig('./rel.json', { cwd: dir });
    expect(resolved).toBe(path.join(dir, 'rel.json'));
  });
  it('fails clearly for missing file, bad JSON, non-object, and missing path', async () => {
    await expect(loadConfig('./nope.json', { cwd: dir })).rejects.toThrow(/file not found/);
    await expect(loadConfig(write('bad.json', '{oops'), { cwd: dir })).rejects.toThrow(/not valid JSON/);
    await expect(loadConfig(write('arr.json', '[]'), { cwd: dir })).rejects.toThrow(/JSON object/);
    await expect(loadConfig(undefined, { cwd: dir })).rejects.toThrow(/--config/);
  });
  it('throws ConfigError with exit code 2', async () => {
    const err = await loadConfig(write('inv.json', {}), { cwd: dir }).catch((e) => e);
    expect(err.exitCode).toBe(2);
  });
});

describe('starter config and JSON schema', () => {
  it('starter config is valid and has dry-run enabled', () => {
    expect(validateConfig(STARTER_CONFIG).options.dryRun).toBe(true);
  });
  it('examples/release.config.json matches the starter config', async () => {
    const example = JSON.parse(await readFile('examples/release.config.json', 'utf8'));
    expect(validateConfig(example)).toEqual(validateConfig(STARTER_CONFIG));
  });
  it('committed JSON schema is up to date (run "node scripts/generate-schema.js")', async () => {
    const committed = JSON.parse(await readFile('schemas/release-config.schema.json', 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(z.toJSONSchema(configSchema, { io: 'input', unrepresentable: 'any' }))));
  });
});
