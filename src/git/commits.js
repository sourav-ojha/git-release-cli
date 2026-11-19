import { GitError, SafetyError } from '../utils/errors.js';

const HASH_PATTERN = /^[0-9a-fA-F]{4,64}$/;
const FIELD = '\u001f';
const RECORD = '\u001e';

export function assertCommitHashFormat(value) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new SafetyError(`Invalid commit hash: ${JSON.stringify(value)}`, {
      hint: 'Provide 4-64 hexadecimal characters (a full or abbreviated SHA).',
    });
  }
}

/** Resolve a user-supplied hash to a full commit SHA. */
export async function resolveCommitHash(git, hash) {
  assertCommitHashFormat(hash);
  const r = await git.tryExec(['rev-parse', '--verify', '--quiet', `${hash}^{commit}`]);
  if (r.code !== 0) {
    throw new SafetyError(`Commit ${hash} does not exist or is not a commit in this repository.`, {
      hint: 'Fetch the latest refs, or check the hash (it may be ambiguous if abbreviated).',
    });
  }
  return r.stdout.trim();
}

/**
 * True when `ancestor` is reachable from `descendant` (a commit is its own ancestor).
 * Exit code 1 means "no"; anything else is an error.
 */
export async function isAncestor(git, ancestor, descendant) {
  const r = await git.tryExec(['merge-base', '--is-ancestor', ancestor, descendant]);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new GitError(`git merge-base --is-ancestor failed: ${r.stderr.trim() || `exit ${r.code}`}`);
}

/**
 * Commits reachable from `to` but not from `from`, newest first.
 * Uses unit/record separators so subjects and bodies can contain anything.
 */
export async function listCommitsInRange(git, from, to, { includeMerges = false } = {}) {
  const args = ['log', `--format=%H${FIELD}%h${FIELD}%an${FIELD}%B${RECORD}`];
  if (!includeMerges) args.push('--no-merges');
  args.push(`${from}..${to}`);
  const out = await git.exec(args);
  return out
    .split(RECORD)
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec.trim() !== '')
    .map((rec) => {
      const [hash, shortHash, author, ...rest] = rec.split(FIELD);
      return { hash, shortHash, author, message: rest.join(FIELD).trim() };
    });
}

export async function mergeBase(git, a, b) {
  const r = await git.tryExec(['merge-base', a, b]);
  if (r.code !== 0) {
    throw new GitError(`No common history between ${a} and ${b}.`, {
      hint: 'In a shallow repository run "git fetch --unshallow"; otherwise the branches are unrelated.',
    });
  }
  return r.stdout.trim();
}

/** Map of path -> resulting blob id for `git diff from to` (no rename detection). */
export async function changedBlobs(git, from, to) {
  const out = await git.exec(['diff', '--raw', '-z', '--no-renames', '--no-abbrev', from, to]);
  const parts = out.split('\0').filter((p, i, a) => p !== '' || i < a.length - 1);
  const map = new Map();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    // meta: ":oldmode newmode oldsha newsha status"
    const meta = parts[i].replace(/^:/, '').split(' ');
    map.set(parts[i + 1], meta[3]);
  }
  return map;
}

/** Full messages of commits reachable from `to` but not `from`. */
export async function listMessages(git, from, to) {
  const out = await git.exec(['log', `--format=%B${RECORD}`, `${from}..${to}`]);
  return out.split(RECORD).map((m) => m.trim()).filter(Boolean);
}
