import { run } from '../utils/command-runner.js';
import { GitError } from '../utils/errors.js';

const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' };

function describe(args) {
  return args.map((a) => (a.length > 120 ? `${a.slice(0, 117)}...` : a)).join(' ');
}

/** Thin wrapper over the native git CLI. Arguments are arrays; no shell is involved. */
export class GitClient {
  constructor({ cwd, runner = run, logger, timeout } = {}) {
    this.cwd = cwd;
    this.runner = runner;
    this.logger = logger;
    this.timeout = timeout;
  }

  /** Run git; resolves with { stdout, stderr, code } regardless of exit code. */
  async tryExec(args, { timeout = this.timeout, input } = {}) {
    this.logger?.debug(`git ${describe(args)}`);
    return this.runner('git', args, { cwd: this.cwd, env: GIT_ENV, timeout, input });
  }

  /** Run git; throws GitError on non-zero exit. Returns trimmed stdout. */
  async exec(args, opts) {
    const result = await this.tryExec(args, opts);
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim();
      throw new GitError(`git ${describe(args)} failed (exit ${result.code})${detail ? `: ${detail}` : ''}`);
    }
    return result.stdout.trim();
  }
}
