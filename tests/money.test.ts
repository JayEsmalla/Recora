import { describe, expect, it } from 'vitest';

import {
  addMinorUnits,
  assertMinorUnits,
  parseMajorAmountToMinor,
} from '../src/domain/money';

describe('money helpers', () => {
  it('parses major currency text into integer minor units', () => {
    expect(parseMajorAmountToMinor('85')).toBe(8500);
    expect(parseMajorAmountToMinor('85.5')).toBe(8550);
    expect(parseMajorAmountToMinor('85.50')).toBe(8550);
    expect(parseMajorAmountToMinor('-10,25')).toBe(-1025);
  });

  it('rejects unsupported precision and malformed amounts', () => {
    expect(() => parseMajorAmountToMinor('1.999')).toThrow();
    expect(() => parseMajorAmountToMinor('PHP 10')).toThrow();
  });

  it('only accepts safe integer minor units', () => {
    expect(assertMinorUnits(125)).toBe(125);
    expect(() => assertMinorUnits(1.25)).toThrow();
    expect(() => assertMinorUnits(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  it('adds minor units without floating point currency math', () => {
    expect(addMinorUnits([100, 250, -50])).toBe(300);
  });
});
