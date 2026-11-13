import { describe, expect, it } from 'vitest';
import { validateHistoryDateRange } from '../src/history/validateHistoryDateRange';

describe('validateHistoryDateRange', () => {
  it('accepts missing and valid calendar dates', () => {
    expect(validateHistoryDateRange('', '')).toBeNull();
    expect(validateHistoryDateRange('2024-02-29', '2026-10-03')).toBeNull();
    expect(validateHistoryDateRange(null, '2026-10-03')).toBeNull();
  });
  it('rejects impossible calendar dates and malformed dates', () => {
    expect(validateHistoryDateRange('2026-02-29', null)).toMatch(/start date/);
    expect(validateHistoryDateRange('2026-1-2', null)).toMatch(/start date/);
    expect(validateHistoryDateRange(null, '2026-13-01')).toMatch(/end date/);
  });
  it('rejects a range that ends before its start', () => {
    expect(validateHistoryDateRange('2026-10-10', '2026-10-01')).toMatch(/end date/);
  });
});
