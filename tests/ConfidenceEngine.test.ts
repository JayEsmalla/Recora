import { describe, expect, it } from 'vitest';

import { computeReceiptConfidence } from '../src/validation/ConfidenceEngine';
import type { ValidationIssue } from '../src/validation/types';
import { validCandidate } from './fixtures/receiptCandidates';

describe('computeReceiptConfidence', () => {
  it('does not fabricate native OCR confidence when the OCR engine did not provide it', () => {
    const fields = computeReceiptConfidence(validCandidate(), []);

    expect(
      fields.every((field) => field.ocrConfidenceBasisPoints === null),
    ).toBe(true);
  });

  it('uses native OCR confidence only when observation confidence exists', () => {
    const observations = new Map<string, number | null>([
      ['total', 0.95],
      ['merchant', 0.8],
    ]);

    const fields = computeReceiptConfidence(
      validCandidate(),
      [],
      observations,
    );

    expect(
      fields.find((field) => field.fieldPath === 'receipt.total')
        ?.ocrConfidenceBasisPoints,
    ).toBe(9500);
    expect(
      fields.find((field) => field.fieldPath === 'receipt.date')
        ?.ocrConfidenceBasisPoints,
    ).toBeNull();
  });

  it('reduces confidence on fields with arithmetic mismatches', () => {
    const issue: ValidationIssue = {
      code: 'total-mismatch',
      state: 'mismatch',
      fieldPath: 'receipt.total',
      message: 'Total mismatch',
      observationIds: ['total'],
    };

    const clean = computeReceiptConfidence(validCandidate(), []);
    const mismatched = computeReceiptConfidence(validCandidate(), [issue]);

    const cleanTotal = clean.find(
      (field) => field.fieldPath === 'receipt.total',
    )!;
    const mismatchTotal = mismatched.find(
      (field) => field.fieldPath === 'receipt.total',
    )!;

    expect(mismatchTotal.confidenceBasisPoints).toBeLessThan(
      cleanTotal.confidenceBasisPoints,
    );
    expect(mismatchTotal.reasons).toContainEqual(
      expect.objectContaining({ signal: 'arithmetic' }),
    );
  });
});
