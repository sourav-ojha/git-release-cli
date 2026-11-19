import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConfigError } from '../utils/errors.js';
import { configSchema, formatZodIssues } from './schema.js';

export function resolveConfigPath(configPath, cwd = process.cwd()) {
  if (!configPath || typeof configPath !== 'string') {
    throw new ConfigError('No configuration file given (--config is required).', {
      hint: 'Pass --config <path>. Run "release-cli init" to create a starter file.',
    });
  }
  const expanded = configPath === '~' || configPath.startsWith('~/') ? path.join(os.homedir(), configPath.slice(1)) : configPath;
  return path.resolve(cwd, expanded);
}

/** Merge CLI overrides (only defined values) into raw config. Returns a new object. */
export function applyOverrides(raw, overrides = {}) {
  const merged = structuredClone(raw);
  const set = (section, key, value) => {
    if (value === undefined) return;
    merged[section] = { ...(merged[section] ?? {}), [key]: value };
  };
  set('release', 'baseBranch', overrides.baseBranch);
  set('release', 'productionBranch', overrides.productionBranch);
  set('options', 'dryRun', overrides.dryRun);
  set('options', 'pushBranch', overrides.pushBranch);
  set('options', 'createPullRequest', overrides.createPullRequest);
  // --no-push without an explicit PR choice implies no PR (a PR needs the pushed branch).
  if (overrides.pushBranch === false && overrides.createPullRequest === undefined) {
    set('options', 'createPullRequest', false);
  }
  return merged;
}

export function validateConfig(raw, source = 'configuration') {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`Invalid ${source}:\n${formatZodIssues(result.error).join('\n')}`, {
      hint: 'Fix the listed properties. Unknown properties are rejected to catch typos.',
    });
  }
  return result.data;
}

/**
 * Load, merge overrides, and validate. Never searches for other config files.
 * @returns {{ config: object, path: string }}
 */
export async function loadConfig(configPath, { cwd = process.cwd(), overrides = {} } = {}) {
  const resolved = resolveConfigPath(configPath, cwd);
  let text;
  try {
    text = await readFile(resolved, 'utf8');
  } catch (cause) {
    const reason = cause.code === 'ENOENT' ? 'file not found' : cause.message;
    throw new ConfigError(`Cannot read configuration file ${resolved}: ${reason}`, {
      hint: 'Check the --config path (relative paths resolve from the current directory).',
      cause,
    });
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new ConfigError(`Configuration file ${resolved} is not valid JSON: ${cause.message}`, { cause });
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError(`Configuration file ${resolved} must contain a JSON object.`);
  }
  const config = validateConfig(applyOverrides(raw, overrides), `configuration (${resolved})`);
  return { config, path: resolved };
}
