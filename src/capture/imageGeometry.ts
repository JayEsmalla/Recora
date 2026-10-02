import type { NormalizedCrop } from './types';

export const FULL_IMAGE_CROP: NormalizedCrop = {
  left: 0,
  top: 0,
  right: 1,
  bottom: 1,
};

const MIN_CROP_FRACTION = 0.08;

export function clampNormalizedCrop(crop: NormalizedCrop): NormalizedCrop {
  const left = clamp(crop.left, 0, 1 - MIN_CROP_FRACTION);
  const top = clamp(crop.top, 0, 1 - MIN_CROP_FRACTION);
  const right = clamp(crop.right, left + MIN_CROP_FRACTION, 1);
  const bottom = clamp(crop.bottom, top + MIN_CROP_FRACTION, 1);

  return { left, top, right, bottom };
}

export type CropCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export function adjustCropCorner(
  crop: NormalizedCrop,
  corner: CropCorner,
  deltaX: number,
  deltaY: number,
): NormalizedCrop {
  const next = { ...crop };

  if (corner === 'top-left' || corner === 'bottom-left') {
    next.left = clamp(crop.left + deltaX, 0, crop.right - MIN_CROP_FRACTION);
  } else {
    next.right = clamp(crop.right + deltaX, crop.left + MIN_CROP_FRACTION, 1);
  }

  if (corner === 'top-left' || corner === 'top-right') {
    next.top = clamp(crop.top + deltaY, 0, crop.bottom - MIN_CROP_FRACTION);
  } else {
    next.bottom = clamp(crop.bottom + deltaY, crop.top + MIN_CROP_FRACTION, 1);
  }

  return next;
}

export function cropCoverage(crop: NormalizedCrop): number {
  const safe = clampNormalizedCrop(crop);
  return (safe.right - safe.left) * (safe.bottom - safe.top);
}

export function normalizedCropToPixels(
  crop: NormalizedCrop,
  width: number,
  height: number,
): { originX: number; originY: number; width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Image dimensions must be positive finite numbers.');
  }

  const safe = clampNormalizedCrop(crop);
  const originX = Math.round(safe.left * width);
  const originY = Math.round(safe.top * height);
  const right = Math.round(safe.right * width);
  const bottom = Math.round(safe.bottom * height);

  return {
    originX,
    originY,
    width: Math.max(1, right - originX),
    height: Math.max(1, bottom - originY),
  };
}

export function computeOcrResize(
  width: number,
  height: number,
  maxPixels = 12_000_000,
  minimumShortEdge = 900,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Image dimensions must be positive finite numbers.');
  }

  const pixels = width * height;
  if (pixels <= maxPixels) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const pixelScale = Math.sqrt(maxPixels / pixels);
  const shortEdge = Math.min(width, height);
  const shortEdgeScale = Math.min(1, minimumShortEdge / shortEdge);
  const scale = Math.min(1, Math.max(pixelScale, shortEdgeScale));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
