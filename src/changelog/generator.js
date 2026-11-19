import { categorize } from './categorizer.js';
import { parseCommits } from './parser.js';

export const EMPTY_NOTES = '_No changes in this release._';

function formatItem(commit, { includeAuthors }) {
  const scope = commit.scope ? `**${commit.scope}:** ` : '';
  const author = includeAuthors && commit.author ? ` — ${commit.author}` : '';
  const lines = [`- ${scope}${commit.subject} (${commit.shortHash})${author}`];
  for (const note of commit.breakingNotes) {
    const [first, ...rest] = note.split('\n');
    lines.push(`  - **BREAKING:** ${first}`);
    for (const line of rest) if (line.trim()) lines.push(`    ${line.trim()}`);
  }
  return lines.join('\n');
}

/** Render categorized Markdown release notes from raw git commits. */
export function generateChangelog(rawCommits, { includeAuthors = false } = {}) {
  const parsed = parseCommits(rawCommits);
  if (parsed.length === 0) return { markdown: EMPTY_NOTES, sections: [], commits: parsed };
  const sections = categorize(parsed);
  const markdown = sections
    .map((s) => `## ${s.heading}\n\n${s.commits.map((c) => formatItem(c, { includeAuthors })).join('\n')}`)
    .join('\n\n');
  return { markdown, sections, commits: parsed };
}
