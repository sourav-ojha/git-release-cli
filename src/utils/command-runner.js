import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { CommandError, MissingBinaryError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Run a program without a shell. Arguments are always passed as an array.
 * Resolves with { stdout, stderr, code } for ANY exit code; callers decide
 * whether a non-zero code is an error. Rejects for spawn failures and timeouts.
 */
export function run(command, args = [], { cwd, input, timeout = DEFAULT_TIMEOUT_MS, env } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    } catch (cause) {
      reject(new CommandError(`Failed to start ${command}: ${cause.message}`, { command, args, cause }));
      return;
    }

    const out = [];
    const err = [];
    let timedOut = false;
    let settled = false;
    const timer = timeout
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 5000).unref();
        }, timeout)
      : null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };

    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.stdin.on('error', () => {});
    child.on('error', (cause) => {
      if (cause.code === 'ENOENT' && cwd && !existsSync(cwd)) {
        finish(reject, new CommandError(`Working directory does not exist: ${cwd}`, { command, args, cause }));
      } else if (cause.code === 'ENOENT') {
        finish(reject, new MissingBinaryError(command));
      } else {
        finish(reject, new CommandError(`Failed to run ${command}: ${cause.message}`, { command, args, cause }));
      }
    });
    child.on('close', (code, signal) => {
      if (timedOut) {
        finish(
          reject,
          new CommandError(`${command} ${args[0] ?? ''} timed out after ${Math.round(timeout / 1000)}s`, {
            command,
            args,
          }),
        );
        return;
      }
      finish(resolve, {
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        code: code ?? (signal ? 128 : 1),
      });
    });

    child.stdin.end(input ?? '');
  });
}
