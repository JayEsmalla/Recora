import { describe, expect, it } from 'vitest';

import {
  extractAmountTokens,
  parseReceiptAmount,
} from '../src/parser/receiptAmounts';

describe('receipt amount parsing', () => {
  it('parses Philippine currency prefixes, grouping, negatives, and trailing minus', () => {
    expect(parseReceiptAmount('₱1,234.50')).toBe(123450);
    expect(parseReceiptAmount('PHP 85.00')).toBe(8500);
    expect(parseReceiptAmount('(25.50)')).toBe(-2550);
    expect(parseReceiptAmount('25.50-')).toBe(-2550);
  });

  it('extracts multiple monetary candidates without using floating point currency values', () => {
    expect(extractAmountTokens('BREAD 2 @ 40.00 80.00').map((token) => token.minor)).toEqual([
      200,
      4000,
      8000,
    ]);
  });

  it('rejects malformed amounts', () => {
    expect(parseReceiptAmount('12.345')).toBeNull();
    expect(parseReceiptAmount('ABC')).toBeNull();
  });
});
