import { run } from '../utils/command-runner.js';
import { GitHubError, MissingBinaryError } from '../utils/errors.js';

const GH_ENV = { GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1' };

/** Thin wrapper over the GitHub CLI. Authentication is entirely delegated to `gh`. */
export class GitHubClient {
  constructor({ cwd, runner = run, logger, timeout = 60_000 } = {}) {
    this.cwd = cwd;
    this.runner = runner;
    this.logger = logger;
    this.timeout = timeout;
  }

  async tryExec(args, { input } = {}) {
    this.logger?.debug(`gh ${args.map((a) => (a.length > 80 ? `${a.slice(0, 77)}...` : a)).join(' ')}`);
    return this.runner('gh', args, { cwd: this.cwd, env: GH_ENV, timeout: this.timeout, input });
  }

  async exec(args, opts) {
    const r = await this.tryExec(args, opts);
    if (r.code !== 0) {
      throw new GitHubError(`gh ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`);
    }
    return r.stdout.trim();
  }

  async assertInstalled() {
    try {
      await this.exec(['--version']);
    } catch (e) {
      if (e instanceof MissingBinaryError) {
        throw new MissingBinaryError('gh', 'Install GitHub CLI from https://cli.github.com and run "gh auth login".');
      }
      throw e;
    }
  }

  async assertAuthenticated() {
    const r = await this.tryExec(['auth', 'status']);
    if (r.code !== 0) {
      throw new GitHubError('GitHub CLI is not authenticated.', {
        hint: 'Run "gh auth login" (or set GH_TOKEN in your environment) and retry.',
      });
    }
  }

  /** Resolve the GitHub repository (OWNER/NAME) for the current checkout. */
  async resolveRepository() {
    const r = await this.tryExec(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    const name = r.stdout.trim();
    if (r.code !== 0 || !name) {
      throw new GitHubError(`GitHub CLI could not resolve this repository: ${r.stderr.trim() || 'no output'}`, {
        hint: 'Ensure the remote points at GitHub and, with several remotes, run "gh repo set-default".',
      });
    }
    return name;
  }
}
