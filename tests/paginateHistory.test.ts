import { describe, expect, it } from 'vitest';

import { paginateHistory } from '../src/history/paginateHistory';

describe('paginateHistory', () => {
  const entries = Array.from({ length: 23 }, (_, index) => index + 1);

  it('shows the first ten entries', () => {
    expect(paginateHistory(entries, 1)).toEqual({
      entries: entries.slice(0, 10), page: 1, pageCount: 3,
      start: 1, end: 10, total: 23,
    });
  });

  it('shows a partial last page without skipping entries', () => {
    expect(paginateHistory(entries, 3)).toMatchObject({
      entries: [21, 22, 23], page: 3, start: 21, end: 23,
    });
  });

  it('clamps invalid page requests', () => {
    expect(paginateHistory(entries, 0).page).toBe(1);
    expect(paginateHistory(entries, 500).page).toBe(3);
    expect(paginateHistory(entries, Number.NaN).page).toBe(1);
  });

  it('shows no result range for empty history', () => {
    expect(paginateHistory([], 4)).toMatchObject({
      entries: [], start: 0, end: 0, total: 0, page: 1, pageCount: 1,
    });
  });

  it('supports a custom page size', () => {
    expect(paginateHistory(entries, 2, 8)).toMatchObject({
      entries: [9, 10, 11, 12, 13, 14, 15, 16],
      start: 9, end: 16, pageCount: 3,
    });
  });
});
