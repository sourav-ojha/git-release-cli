import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STARTER_CONFIG } from '../config/defaults.js';
import { ReleaseError, UserAbortError } from '../utils/errors.js';
import { confirm } from '../utils/prompt.js';

export async function initCommand(opts, { logger, cwd = process.cwd(), ask = confirm } = {}) {
  const target = path.resolve(cwd, opts.output ?? 'release.config.json');
  const content = `${JSON.stringify(STARTER_CONFIG, null, 2)}\n`;
  try {
    await writeFile(target, content, { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw new ReleaseError(`Cannot write ${target}: ${e.message}`, { cause: e });
    const ok = opts.force || (await ask(`${target} already exists. Overwrite?`));
    if (!ok) throw new UserAbortError(`Kept existing ${target}.`);
    await writeFile(target, content);
  }
  logger.success(`Wrote ${target} (dry-run is enabled by default).`);
  return target;
}
