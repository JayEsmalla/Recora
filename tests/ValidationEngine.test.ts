import { describe, expect, it } from 'vitest';

import { validateReceiptCandidate } from '../src/validation/ValidationEngine';
import { validCandidate } from './fixtures/receiptCandidates';

const now = new Date('2026-10-03T12:00:00Z');

describe('validateReceiptCandidate', () => {
  it('verifies a receipt whose item, subtotal, adjustment, and total arithmetic reconcile', () => {
    const report = validateReceiptCandidate(validCandidate(), { now });

    expect(report.state).toBe('verified');
    expect(report.issues).toHaveLength(0);
    expect(report.counters).toEqual({
      lineArithmeticChecked: 1,
      lineArithmeticMismatches: 0,
      subtotalChecks: 1,
      subtotalMismatches: 0,
      totalChecks: 1,
      totalMismatches: 0,
    });
  });

  it('flags quantity x unit price mismatches on the affected item', () => {
    const candidate = validCandidate();
    candidate.items[0]!.lineTotalMinor = 7900;

    const report = validateReceiptCandidate(candidate, { now });

    expect(report.state).toBe('mismatch');
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'line-arithmetic-mismatch',
        fieldPath: 'items.item-1',
        expectedMinor: 8000,
        actualMinor: 7900,
      }),
    );
  });

  it('flags subtotal and final-total mismatches independently', () => {
    const candidate = validCandidate();
    candidate.summary.subtotalMinor = 16000;
    candidate.summary.totalMinor = 18000;

    const report = validateReceiptCandidate(candidate, { now });

    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'subtotal-mismatch' }),
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'total-mismatch' }),
    );
    expect(report.counters.subtotalMismatches).toBe(1);
    expect(report.counters.totalMismatches).toBe(1);
  });

  it('supports receipts without an explicit subtotal by reconciling item totals to final total', () => {
    const candidate = validCandidate();
    candidate.summary.subtotalMinor = null;
    candidate.summary.subtotalSourceIds = [];

    const report = validateReceiptCandidate(candidate, { now });

    expect(report.state).toBe('verified');
    expect(report.counters.subtotalChecks).toBe(0);
    expect(report.counters.totalChecks).toBe(1);
  });

  it('requires review rather than inventing a locale for an ambiguous date', () => {
    const candidate = validCandidate();
    candidate.date = {
      raw: '10/03/2026',
      isoDateTime: null,
      ambiguous: true,
      observationIds: ['date'],
    };
    candidate.warnings = [
      {
        code: 'ambiguous-date',
        message: 'Ambiguous date',
        observationIds: ['date'],
      },
    ];

    const report = validateReceiptCandidate(candidate, { now });

    expect(report.state).toBe('review');
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'ambiguous-date',
        fieldPath: 'receipt.date',
      }),
    );
  });

  it('surfaces parser duplicate warnings as review-required item evidence', () => {
    const candidate = validCandidate();
    candidate.items.push({
      ...candidate.items[1]!,
      id: 'item-3',
      position: 2,
      possibleDuplicateOf: 'item-2',
      observationIds: ['item-3'],
    });
    candidate.summary.subtotalMinor = 25000;
    candidate.summary.totalMinor = 25500;
    candidate.warnings = [
      {
        code: 'possible-duplicate-line',
        message: 'Duplicate candidate',
        observationIds: ['item-3'],
      },
    ];

    const report = validateReceiptCandidate(candidate, { now });

    expect(report.state).toBe('review');
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'possible-duplicate-line',
        fieldPath: 'items.item-3',
      }),
    );
  });

  it('treats missing total and missing items as blocking mismatches', () => {
    const candidate = validCandidate();
    candidate.items = [];
    candidate.summary.subtotalMinor = null;
    candidate.summary.totalMinor = null;

    const report = validateReceiptCandidate(candidate, { now });

    expect(report.state).toBe('mismatch');
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-total' }),
        expect.objectContaining({ code: 'missing-items' }),
      ]),
    );
  });

  it('blocks an item with a missing name or line total', () => {
    const candidate = validCandidate();
    candidate.items[0]!.rawName = '';
    candidate.items[1]!.lineTotalMinor = null;
    candidate.summary.subtotalMinor = null;
    candidate.summary.totalMinor = 8000;

    const report = validateReceiptCandidate(candidate, { now });

    expect(report.state).toBe('mismatch');
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing-item-name',
          fieldPath: 'items.item-1',
        }),
        expect.objectContaining({
          code: 'missing-line-total',
          fieldPath: 'items.item-2',
        }),
      ]),
    );
  });

  it('flags a purchase item with a zero or negative line amount for review', () => {
    const candidate = validCandidate();
    candidate.items[1]!.lineTotalMinor = 0;
    candidate.summary.subtotalMinor = 8000;
    candidate.summary.totalMinor = 8500;

    const report = validateReceiptCandidate(candidate, { now });

    expect(report.state).toBe('review');
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'unexpected-line-value' }),
    );
  });
});
