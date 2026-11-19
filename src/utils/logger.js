const COLORS = { red: 31, green: 32, yellow: 33, cyan: 36, dim: 2, bold: 1 };

export function createLogger({
  verbose = false,
  out = process.stdout,
  err = process.stderr,
  color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
} = {}) {
  const paint = (name, text) => (color ? `\u001b[${COLORS[name]}m${text}\u001b[0m` : text);
  return {
    verbose,
    paint,
    plain: (msg = '') => out.write(`${msg}\n`),
    info: (msg) => out.write(`${msg}\n`),
    step: (msg) => out.write(`${paint('cyan', '›')} ${msg}\n`),
    success: (msg) => out.write(`${paint('green', '✔')} ${msg}\n`),
    warn: (msg) => err.write(`${paint('yellow', '!')} ${msg}\n`),
    error: (msg) => err.write(`${paint('red', '✖')} ${msg}\n`),
    debug: (msg) => {
      if (verbose) err.write(`${paint('dim', `[debug] ${msg}`)}\n`);
    },
  };
}

/** Silent logger for tests / library use. */
export function createNullLogger() {
  const noop = () => {};
  return { verbose: false, paint: (_n, t) => t, plain: noop, info: noop, step: noop, success: noop, warn: noop, error: noop, debug: noop };
}
