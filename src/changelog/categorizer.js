import { BREAKING_KEY, CATEGORIES, categoryKeyForType } from '../constants/categories.js';

/**
 * Group parsed commits into ordered sections. Breaking commits appear only in the
 * Breaking Changes section. Empty sections are omitted. Order inside a section
 * follows input order (git log, newest first).
 * @returns {{key: string, heading: string, commits: object[]}[]}
 */
export function categorize(commits) {
  const buckets = new Map(CATEGORIES.map((c) => [c.key, []]));
  for (const commit of commits) {
    const key = commit.breaking ? BREAKING_KEY : categoryKeyForType(commit.type);
    buckets.get(key).push(commit);
  }
  return CATEGORIES.filter((c) => buckets.get(c.key).length > 0).map((c) => ({
    key: c.key,
    heading: c.heading,
    commits: buckets.get(c.key),
  }));
}
