import { loadConfig } from '../config/loader.js';

/** Print the validated effective configuration. Config holds no secrets (unknown keys are rejected). */
export async function configCommand(opts, { logger, cwd = process.cwd() } = {}) {
  const { config, path } = await loadConfig(opts.config, { cwd });
  logger.info(`# ${path}`);
  logger.info(JSON.stringify(config, null, 2));
  return config;
}
