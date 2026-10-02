import { describe, expect, it } from 'vitest';

import { assessReceiptImageQuality } from '../src/capture/ImageQualityGate';
import type {
  ManualQualityChecks,
  PreparedReceiptImage,
} from '../src/capture/types';

const clearChecks: ManualQualityChecks = {
  sharpText: true,
  evenLighting: true,
  fullyVisible: true,
};

const goodImage: PreparedReceiptImage = {
  uri: 'file:///receipt.jpg',
  width: 1600,
  height: 3200,
  fileSize: 800_000,
  cropCoverage: 0.8,
};

describe('receipt image quality gate', () => {
  it('allows a readable receipt after visual confirmation', () => {
    const assessment = assessReceiptImageQuality(goodImage, clearChecks);

    expect(assessment.canContinue).toBe(true);
    expect(assessment.issues).toHaveLength(0);
  });

  it('blocks images that are too small for reliable OCR', () => {
    const assessment = assessReceiptImageQuality(
      { ...goodImage, width: 320, height: 500 },
      clearChecks,
    );

    expect(assessment.canContinue).toBe(false);
    expect(assessment.issues.some((issue) => issue.code === 'tiny-image')).toBe(true);
  });

  it('blocks the workflow when the user confirms blur, lighting, or framing problems', () => {
    const assessment = assessReceiptImageQuality(goodImage, {
      sharpText: false,
      evenLighting: false,
      fullyVisible: false,
    });

    expect(assessment.canContinue).toBe(false);
    expect(assessment.issues.filter((issue) => issue.severity === 'blocker')).toHaveLength(3);
  });

  it('warns without rejecting unusually long but readable receipts', () => {
    const assessment = assessReceiptImageQuality(
      { ...goodImage, width: 1000, height: 8000 },
      clearChecks,
    );

    expect(assessment.canContinue).toBe(true);
    expect(assessment.issues.some((issue) => issue.code === 'very-long-receipt')).toBe(true);
  });
});
