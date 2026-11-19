#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { configCommand } from './commands/config.js';
import { initCommand } from './commands/init.js';
import { releaseCommand } from './commands/release.js';
import { createLogger } from './utils/logger.js';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const program = new Command();
program.name('release-cli').description(pkg.description).version(pkg.version);

let logger = createLogger();
const wrap = (fn) => async (...args) => {
  const cmd = args[args.length - 1];
  const opts = cmd.opts();
  logger = createLogger({ verbose: Boolean(opts.verbose) });
  try {
    await fn(opts, cmd);
  } catch (error) {
    reportError(error);
    process.exitCode = error.exitCode ?? 1;
  }
};

function reportError(error) {
  const known = typeof error.exitCode === 'number';
  logger.error(known ? error.message : `Unexpected error: ${error.message}`);
  if (error.step) logger.error(`Failed at step: ${error.step}`);
  if (error.hint) logger.info(`  Hint: ${error.hint}`);
  if (error.partialState?.length) {
    logger.warn('PARTIAL STATE — the release did not complete:');
    for (const line of error.partialState) logger.warn(`  - ${line}`);
  }
  if (logger.verbose && error.stack) logger.debug(error.stack);
}

program
  .command('release')
  .description('Create a release branch, release notes and a pull request (dry-run is the safe default)')
  .requiredOption('--config <path>', 'path to the JSON configuration file')
  .option('--commit <hash>', 'release cutoff commit (default: latest of the base branch)')
  .option('--base-branch <name>', 'override release.baseBranch')
  .option('--production-branch <name>', 'override release.productionBranch')
  .option('--dry-run', 'preview only; change nothing')
  .option('--no-dry-run', 'perform the release even if the config enables dryRun')
  .option('--no-push', 'do not push the release branch (implies --no-pr)')
  .option('--no-pr', 'do not create a pull request')
  .option('-y, --yes', 'skip the confirmation prompt')
  .option('-C, --cwd <path>', 'repository directory (default: current directory)')
  .option('--verbose', 'print debug output')
  .action(wrap((opts, cmd) => releaseCommand(opts, { logger, sourceOf: (k) => cmd.getOptionValueSource(k) })));

program
  .command('init')
  .description('Write a starter release.config.json to the current directory')
  .option('-o, --output <path>', 'output file', 'release.config.json')
  .option('--force', 'overwrite an existing file without asking')
  .option('--verbose', 'print debug output')
  .action(wrap((opts) => initCommand(opts, { logger })));

program
  .command('config')
  .description('Validate and print the effective configuration')
  .requiredOption('--config <path>', 'path to the JSON configuration file')
  .option('--verbose', 'print debug output')
  .action(wrap((opts) => configCommand(opts, { logger })));

await program.parseAsync(process.argv);
