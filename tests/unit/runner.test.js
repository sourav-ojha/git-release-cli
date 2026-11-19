import { describe, expect, it } from 'vitest';
import { run } from '../../src/utils/command-runner.js';

describe('command runner', () => {
  it('passes args verbatim without a shell', async () => {
    const r = await run(process.execPath, ['-e', 'console.log(process.argv[1])', '$(echo pwned); `x` | y']);
    expect(r.stdout.trim()).toBe('$(echo pwned); `x` | y');
  });
  it('returns non-zero codes without throwing', async () => {
    expect((await run(process.execPath, ['-e', 'process.exit(3)'])).code).toBe(3);
  });
  it('feeds stdin', async () => {
    const r = await run(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'hi' });
    expect(r.stdout).toBe('hi');
  });
  it('rejects on missing binary', async () => {
    await expect(run('no-such-binary-xyz', [])).rejects.toThrow(/not found on PATH/);
  });
  it('rejects on timeout', async () => {
    await expect(run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 200 })).rejects.toThrow(/timed out/);
  });
});
