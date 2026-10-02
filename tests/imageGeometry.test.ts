import { describe, expect, it } from 'vitest';

import {
  adjustCropCorner,
  clampNormalizedCrop,
  computeOcrResize,
  cropCoverage,
  normalizedCropToPixels,
} from '../src/capture/imageGeometry';

describe('receipt image geometry', () => {
  it('converts a normalized crop into image pixels', () => {
    expect(
      normalizedCropToPixels(
        { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 },
        1000,
        2000,
      ),
    ).toEqual({
      originX: 100,
      originY: 400,
      width: 800,
      height: 1200,
    });
  });

  it('clamps invalid crop bounds and preserves a minimum crop area', () => {
    const crop = clampNormalizedCrop({
      left: -1,
      top: 0.95,
      right: 2,
      bottom: 0.2,
    });

    expect(crop.left).toBe(0);
    expect(crop.right).toBe(1);
    expect(crop.bottom - crop.top).toBeCloseTo(0.08);
    expect(cropCoverage(crop)).toBeGreaterThan(0);
  });

  it('moves one crop corner without dragging the opposite edge', () => {
    const adjusted = adjustCropCorner(
      { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 },
      'top-left',
      0.2,
      0.15,
    );

    expect(adjusted).toEqual({
      left: 0.30000000000000004,
      top: 0.25,
      right: 0.9,
      bottom: 0.9,
    });
  });

  it('prevents a crop handle from crossing the opposite edge', () => {
    const adjusted = adjustCropCorner(
      { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 },
      'bottom-right',
      -1,
      -1,
    );

    expect(adjusted.right).toBeCloseTo(0.18);
    expect(adjusted.bottom).toBeCloseTo(0.18);
  });

  it('keeps normal images unchanged', () => {
    expect(computeOcrResize(1600, 3000)).toEqual({
      width: 1600,
      height: 3000,
    });
  });

  it('limits huge images while protecting receipt text width', () => {
    const resized = computeOcrResize(2400, 12000);

    expect(resized.width).toBeGreaterThanOrEqual(900);
    expect(resized.width).toBeLessThan(2400);
    expect(resized.height).toBeLessThan(12000);
  });
});
