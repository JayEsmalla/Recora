import { describe, expect, it } from 'vitest';

import type { ReceiptCandidate } from '../src/parser/types';
import { validateReceiptCandidate } from '../src/validation/ValidationEngine';
import { validCandidate } from './fixtures/receiptCandidates';

const now = new Date('2026-10-03T12:00:00Z');

interface CorpusCase {
  id: string;
  expectedMismatch: boolean;
  candidate: ReceiptCandidate;
}

describe('controlled validation corpus', () => {
  it('detects every deterministic arithmetic mismatch without false mismatches', () => {
    const corpus = buildCorpus();
    const results = corpus.map((entry) => ({
      ...entry,
      actualMismatch:
        validateReceiptCandidate(entry.candidate, { now }).state === 'mismatch',
    }));

    const expectedMismatches = results.filter((entry) => entry.expectedMismatch);
    const detectedMismatches = expectedMismatches.filter(
      (entry) => entry.actualMismatch,
    );
    const validCases = results.filter((entry) => !entry.expectedMismatch);
    const falseMismatches = validCases.filter((entry) => entry.actualMismatch);

    expect(detectedMismatches).toHaveLength(expectedMismatches.length);
    expect(falseMismatches).toHaveLength(0);

    const detectionRate =
      detectedMismatches.length / Math.max(1, expectedMismatches.length);
    const falseMismatchRate =
      falseMismatches.length / Math.max(1, validCases.length);

    expect(detectionRate).toBe(1);
    expect(falseMismatchRate).toBeLessThanOrEqual(0.05);
  });
});

function buildCorpus(): CorpusCase[] {
  const standard = validCandidate();

  const missingSubtotal = validCandidate();
  missingSubtotal.summary.subtotalMinor = null;
  missingSubtotal.summary.subtotalSourceIds = [];

  const oneCentTolerance = validCandidate();
  oneCentTolerance.items[0]!.lineTotalMinor = 8001;
  oneCentTolerance.summary.subtotalMinor = 16501;
  oneCentTolerance.summary.totalMinor = 17001;

  const returnReceipt = validCandidate();
  returnReceipt.transactionType = 'return';
  returnReceipt.items[1]!.lineTotalMinor = -8500;
  returnReceipt.summary.subtotalMinor = -500;
  returnReceipt.summary.adjustments = [];
  returnReceipt.summary.totalMinor = -500;

  const lineMismatch = validCandidate();
  lineMismatch.items[0]!.lineTotalMinor = 7000;
  lineMismatch.summary.subtotalMinor = 15500;
  lineMismatch.summary.totalMinor = 16000;

  const subtotalMismatch = validCandidate();
  subtotalMismatch.summary.subtotalMinor = 16000;
  subtotalMismatch.summary.totalMinor = 16500;

  const totalMismatch = validCandidate();
  totalMismatch.summary.totalMinor = 17500;

  const missingCritical = validCandidate();
  missingCritical.items = [];
  missingCritical.summary.subtotalMinor = null;
  missingCritical.summary.totalMinor = null;

  return [
    { id: 'standard-valid', expectedMismatch: false, candidate: standard },
    {
      id: 'missing-subtotal-valid',
      expectedMismatch: false,
      candidate: missingSubtotal,
    },
    {
      id: 'one-cent-tolerance-valid',
      expectedMismatch: false,
      candidate: oneCentTolerance,
    },
    { id: 'return-valid', expectedMismatch: false, candidate: returnReceipt },
    { id: 'line-mismatch', expectedMismatch: true, candidate: lineMismatch },
    {
      id: 'subtotal-mismatch',
      expectedMismatch: true,
      candidate: subtotalMismatch,
    },
    { id: 'total-mismatch', expectedMismatch: true, candidate: totalMismatch },
    {
      id: 'missing-critical',
      expectedMismatch: true,
      candidate: missingCritical,
    },
  ];
}
