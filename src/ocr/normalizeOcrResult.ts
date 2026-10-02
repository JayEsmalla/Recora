import type { OcrResult } from 'rn-mlkit-ocr';

import type {
  OcrBlock,
  OcrDocument,
  OcrElement,
  OcrFrame,
  OcrLine,
} from './types';

export function normalizeMlKitResult(
  result: OcrResult,
  imageWidth: number,
  imageHeight: number,
  engine: string,
): OcrDocument {
  assertImageDimensions(imageWidth, imageHeight);

  return {
    engine,
    imageWidth,
    imageHeight,
    rawText: result.text ?? '',
    blocks: result.blocks.map((block, blockIndex): OcrBlock => ({
      id: `b${blockIndex}`,
      text: block.text,
      frame: sanitizeFrame(block.frame, imageWidth, imageHeight),
      confidence: null,
      lines: block.lines.map((line, lineIndex): OcrLine => ({
        id: `b${blockIndex}-l${lineIndex}`,
        text: line.text,
        frame: sanitizeFrame(line.frame, imageWidth, imageHeight),
        confidence: null,
        elements: line.elements.map((element, elementIndex): OcrElement => ({
          id: `b${blockIndex}-l${lineIndex}-e${elementIndex}`,
          text: element.text,
          frame: sanitizeFrame(element.frame, imageWidth, imageHeight),
          confidence: null,
        })),
      })),
    })),
  };
}

function sanitizeFrame(
  frame: OcrFrame,
  imageWidth: number,
  imageHeight: number,
): OcrFrame {
  const x = clampFinite(frame?.x, 0, imageWidth);
  const y = clampFinite(frame?.y, 0, imageHeight);
  const width = clampFinite(frame?.width, 0, imageWidth - x);
  const height = clampFinite(frame?.height, 0, imageHeight - y);

  return { x, y, width, height };
}

function clampFinite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function assertImageDimensions(width: number, height: number): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('OCR image dimensions must be positive finite numbers.');
  }
}
