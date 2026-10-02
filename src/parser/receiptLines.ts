import type { OcrDocument, OcrLine } from '../ocr/types';

export function flattenReceiptLines(document: OcrDocument): OcrLine[] {
  return document.blocks
    .flatMap((block) => block.lines)
    .filter((line) => line.text.trim().length > 0)
    .sort(compareLines);
}

export function compareLines(left: OcrLine, right: OcrLine): number {
  const leftCenterY = left.frame.y + left.frame.height / 2;
  const rightCenterY = right.frame.y + right.frame.height / 2;
  const verticalTolerance = Math.max(
    4,
    Math.min(left.frame.height, right.frame.height) * 0.45,
  );

  if (Math.abs(leftCenterY - rightCenterY) <= verticalTolerance) {
    return left.frame.x - right.frame.x;
  }

  return leftCenterY - rightCenterY;
}

export function normalizeReceiptText(text: string): string {
  return text
    .replace(/[\u00A0\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function lettersRatio(text: string): number {
  const compact = text.replace(/\s/g, '');
  if (!compact) {
    return 0;
  }
  const letters = compact.match(/[A-Za-z]/g)?.length ?? 0;
  return letters / compact.length;
}
