import { describe, expect, it } from 'vitest';

import { parseDateText } from '../src/parser/receiptDates';

describe('receipt date parsing', () => {
  it('parses an unambiguous day-first numeric date', () => {
    expect(parseDateText('DATE 13/03/2026 09:05')).toEqual({
      raw: '13/03/2026 09:05',
      isoDateTime: '2026-03-13T09:05:00',
      ambiguous: false,
    });
  });

  it('parses ISO-style dates and named dates', () => {
    expect(parseDateText('2026-10-13')).toEqual({
      raw: '2026-10-13',
      isoDateTime: '2026-10-13',
      ambiguous: false,
    });

    expect(parseDateText('Oct 13, 2026 18:45')).toEqual({
      raw: 'Oct 13, 2026 18:45',
      isoDateTime: '2026-10-13T18:45:00',
      ambiguous: false,
    });
  });

  it('does not silently resolve locale-ambiguous numeric dates', () => {
    expect(parseDateText('10/03/2026')).toEqual({
      raw: '10/03/2026',
      isoDateTime: null,
      ambiguous: true,
      alternativeIsoDateTimes: ['2026-10-03', '2026-03-10'],
    });
  });

  it('preserves malformed calendar dates as review-required evidence', () => {
    expect(parseDateText('31/02/2026')).toEqual({
      raw: '31/02/2026',
      isoDateTime: null,
      ambiguous: true,
    });
  });
});
