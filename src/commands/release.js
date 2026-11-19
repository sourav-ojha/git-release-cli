import { loadConfig } from '../config/loader.js';
import { runRelease } from '../release/release-manager.js';
import { confirm } from '../utils/prompt.js';

/** Build config overrides from commander options, honoring only values the user actually passed. */
export function overridesFromOptions(opts, sourceOf = () => 'cli') {
  const passed = (key) => sourceOf(key) === 'cli';
  return {
    baseBranch: opts.baseBranch,
    productionBranch: opts.productionBranch,
    dryRun: passed('dryRun') ? opts.dryRun : undefined,
    pushBranch: passed('push') ? opts.push : undefined,
    createPullRequest: passed('pr') ? opts.pr : undefined,
  };
}

export async function releaseCommand(opts, { logger, sourceOf, cwd = process.cwd(), runner, github, now } = {}) {
  const workDir = opts.cwd ? (await import('node:path')).resolve(cwd, opts.cwd) : cwd;
  const { config, path } = await loadConfig(opts.config, { cwd, overrides: overridesFromOptions(opts, sourceOf) });
  logger.debug(`config: ${path}`);
  return runRelease({
    config, cwd: workDir, commit: opts.commit, logger, yes: Boolean(opts.yes), confirm, runner, github, now,
  });
}
