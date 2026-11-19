import { describe, expect, it } from 'vitest';
import { formatLongDate, formatTimestamp } from '../../src/utils/date.js';
import { generateBranchName } from '../../src/release/release-branch.js';

const d = new Date(2026, 10, 19, 10, 30, 5);

describe('timestamps', () => {
  it('formats default pattern', () => expect(formatTimestamp(d, 'YYYYMMDD-HHmmss')).toBe('20261119-103005'));
  it('formats custom pattern', () => expect(formatTimestamp(d, 'YYYY-MM-DD_HH.mm')).toBe('2026-11-19_10.30'));
  it('zero-pads', () => expect(formatTimestamp(new Date(2026, 0, 2, 3, 4, 5), 'YYYYMMDD-HHmmss')).toBe('20260102-030405'));
  it('long date', () => expect(formatLongDate(d)).toBe('19 November 2026'));
});

describe('branch names', () => {
  it('uses prefix and format', () => {
    expect(generateBranchName({ branchPrefix: 'release', branchTimestampFormat: 'YYYYMMDD-HHmmss' }, d)).toBe('release/20261119-103005');
    expect(generateBranchName({ branchPrefix: 'rel/prod', branchTimestampFormat: 'YYYY-MM-DD' }, d)).toBe('rel/prod/2026-11-19');
  });
});
