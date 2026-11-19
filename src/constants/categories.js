/** Ordered changelog sections. `types` lists the conventional-commit types mapped to each. */
export const CATEGORIES = [
  { key: 'breaking', heading: 'Breaking Changes', types: [] },
  { key: 'feat', heading: 'Features', types: ['feat'] },
  { key: 'fix', heading: 'Bug Fixes', types: ['fix'] },
  { key: 'perf', heading: 'Performance Improvements', types: ['perf'] },
  { key: 'refactor', heading: 'Code Refactoring', types: ['refactor'] },
  { key: 'docs', heading: 'Documentation', types: ['docs'] },
  { key: 'test', heading: 'Tests', types: ['test'] },
  { key: 'build', heading: 'Build System', types: ['build'] },
  { key: 'ci', heading: 'CI/CD', types: ['ci'] },
  { key: 'chore', heading: 'Maintenance', types: ['chore'] },
  { key: 'style', heading: 'Code Style', types: ['style'] },
  { key: 'revert', heading: 'Reverts', types: ['revert'] },
  { key: 'other', heading: 'Other Changes', types: [] },
];

export const OTHER_KEY = 'other';
export const BREAKING_KEY = 'breaking';

export function categoryKeyForType(type) {
  if (!type) return OTHER_KEY;
  const t = type.toLowerCase();
  const found = CATEGORIES.find((c) => c.types.includes(t));
  return found ? found.key : OTHER_KEY;
}
