import { CommitParser } from 'conventional-commits-parser';

const parser = new CommitParser({
  headerPattern: /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/,
  headerCorrespondence: ['type', 'scope', 'bang', 'subject'],
});

const REVERT_HEADER = /^Revert\s+"/;

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * Parse one raw git commit ({hash, shortHash, author, message}) into a normalized record.
 * Non-conventional messages keep `type: null` and use the first line as subject.
 */
export function parseCommit(raw) {
  const parsed = parser.parse(raw.message);
  const header = (parsed.header ?? raw.message.split('\n')[0] ?? '').trim();
  const conventional = Boolean(parsed.type && parsed.subject);

  let type = conventional ? parsed.type.toLowerCase() : null;
  if (!conventional && REVERT_HEADER.test(header)) type = 'revert';

  const breakingNotes = (parsed.notes ?? [])
    .filter((n) => /^BREAKING[ -]CHANGE$/.test(n.title))
    .map((n) => n.text.trim())
    .filter(Boolean);
  const breaking = Boolean(parsed.bang) || (parsed.notes ?? []).some((n) => /^BREAKING[ -]CHANGE$/.test(n.title));

  return {
    hash: raw.hash,
    shortHash: raw.shortHash,
    author: raw.author,
    type,
    scope: conventional && parsed.scope ? parsed.scope.trim() : null,
    subject: capitalize(conventional ? parsed.subject.trim() : header),
    breaking,
    breakingNotes,
    conventional,
  };
}

export function parseCommits(rawCommits) {
  return rawCommits.map(parseCommit);
}
