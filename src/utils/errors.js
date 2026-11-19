/** Base error for expected, user-facing failures. */
export class ReleaseError extends Error {
  constructor(message, { hint, step, exitCode = 1, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = new.target.name;
    this.hint = hint;
    this.step = step;
    this.exitCode = exitCode;
    /** Human-readable lines describing what already changed before the failure. */
    this.partialState = [];
  }
}

export class ConfigError extends ReleaseError {
  constructor(message, opts = {}) {
    super(message, { exitCode: 2, ...opts });
  }
}

export class GitError extends ReleaseError {}
export class SafetyError extends ReleaseError {}
export class GitHubError extends ReleaseError {}

export class MissingBinaryError extends ReleaseError {
  constructor(binary, hint) {
    super(`Required program not found on PATH: ${binary}`, { hint });
    this.binary = binary;
  }
}

export class CommandError extends ReleaseError {
  constructor(message, { command, args, result, cause } = {}) {
    super(message, { cause });
    this.command = command;
    this.args = args;
    this.result = result;
  }
}

export class UserAbortError extends ReleaseError {
  constructor(message = 'Aborted by user. Nothing was changed.') {
    super(message);
  }
}
