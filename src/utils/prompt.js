import readline from 'node:readline/promises';
import { ReleaseError } from './errors.js';

/** Ask a yes/no question. Refuses to guess when no TTY is attached. */
export async function confirm(question, { input = process.stdin, output = process.stderr } = {}) {
  if (!input.isTTY) {
    throw new ReleaseError('Confirmation required but no interactive terminal is available.', {
      hint: 'Re-run with --yes to confirm non-interactively, or use --dry-run to preview.',
    });
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
