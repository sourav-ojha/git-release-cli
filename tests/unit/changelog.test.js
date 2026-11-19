import { describe, expect, it } from 'vitest';
import { parseCommit } from '../../src/changelog/parser.js';
import { generateChangelog, EMPTY_NOTES } from '../../src/changelog/generator.js';
import { categorize } from '../../src/changelog/categorizer.js';

let n = 0;
const raw = (message, author = 'Ann') => {
  n += 1;
  const hash = String(n).padStart(40, 'a');
  return { hash, shortHash: hash.slice(0, 7), author, message };
};

describe('parseCommit', () => {
  it('parses type, scope, subject', () => {
    expect(parseCommit(raw('feat(auth): add SSO login'))).toMatchObject({ type: 'feat', scope: 'auth', subject: 'Add SSO login', breaking: false });
  });
  it('handles scope-less and uppercase types', () => {
    expect(parseCommit(raw('Fix: crash'))).toMatchObject({ type: 'fix', scope: null });
  });
  it('detects ! breaking markers', () => {
    expect(parseCommit(raw('feat!: change authentication flow')).breaking).toBe(true);
    expect(parseCommit(raw('fix(api)!: change response structure'))).toMatchObject({ breaking: true, scope: 'api' });
  });
  it('detects BREAKING CHANGE footers and captures text', () => {
    const c = parseCommit(raw('refactor: core\n\nbody\n\nBREAKING CHANGE: config renamed\nsee docs'));
    expect(c.breaking).toBe(true);
    expect(c.breakingNotes).toEqual(['config renamed\nsee docs']);
  });
  it('keeps non-conventional messages with their first line', () => {
    expect(parseCommit(raw('Update the readme\n\nlong body'))).toMatchObject({ type: null, conventional: false, subject: 'Update the readme' });
  });
  it('treats git revert messages as reverts', () => {
    expect(parseCommit(raw('Revert "feat: x"\n\nThis reverts commit abc.')).type).toBe('revert');
  });
  it('does not misparse prose containing a colon', () => {
    expect(parseCommit(raw('Merge branch x: into y')).type).toBeNull();
  });
});

describe('categorize / generateChangelog', () => {
  it('orders sections deterministically with Breaking first and Other last', () => {
    const { markdown, sections } = generateChangelog([
      raw('random thing'),
      raw('chore: deps'),
      raw('fix: bug'),
      raw('feat: new'),
      raw('feat!: big'),
      raw('wip: unknown type'),
      raw('revert: undo'),
      raw('style: fmt'), raw('ci: pipeline'), raw('build: webpack'), raw('test: more'), raw('docs: readme'), raw('refactor: tidy'), raw('perf: faster'),
    ]);
    expect(sections.map((s) => s.heading)).toEqual([
      'Breaking Changes', 'Features', 'Bug Fixes', 'Performance Improvements', 'Code Refactoring', 'Documentation',
      'Tests', 'Build System', 'CI/CD', 'Maintenance', 'Code Style', 'Reverts', 'Other Changes',
    ]);
    expect(markdown.indexOf('## Breaking Changes')).toBeLessThan(markdown.indexOf('## Features'));
    const other = sections.at(-1).commits.map((c) => c.subject);
    expect(other).toEqual(['Random thing', 'Unknown type']);
  });

  it('renders scope, short hash and authors', () => {
    const c = raw('feat(auth): add SSO login', 'Dana');
    expect(generateChangelog([c]).markdown).toBe(`## Features\n\n- **auth:** Add SSO login (${c.shortHash})`);
    expect(generateChangelog([c], { includeAuthors: true }).markdown).toContain(`(${c.shortHash}) — Dana`);
  });

  it('lists a breaking commit only under Breaking Changes, with its note', () => {
    const { markdown } = generateChangelog([raw('feat(x)!: drop v1\n\nBREAKING CHANGE: v1 removed')]);
    expect(markdown).toMatch(/^## Breaking Changes\n\n- \*\*x:\*\* Drop v1 \(\w+\)\n {2}- \*\*BREAKING:\*\* v1 removed$/);
    expect(markdown).not.toContain('## Features');
  });

  it('handles an empty range', () => {
    const r = generateChangelog([]);
    expect(r.markdown).toBe(EMPTY_NOTES);
    expect(r.sections).toEqual([]);
    expect(categorize([])).toEqual([]);
  });
});
