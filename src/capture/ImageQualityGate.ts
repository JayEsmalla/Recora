import type {
  ManualQualityChecks,
  PreparedReceiptImage,
  QualityAssessment,
  QualityIssue,
} from './types';

export function assessReceiptImageQuality(
  image: PreparedReceiptImage,
  manual: ManualQualityChecks,
): QualityAssessment {
  const issues: QualityIssue[] = [];
  const shortEdge = Math.min(image.width, image.height);
  const pixels = image.width * image.height;
  const longToShort = Math.max(image.width, image.height) / shortEdge;

  if (pixels < 600_000 || shortEdge < 500) {
    issues.push({
      code: 'tiny-image',
      severity: 'blocker',
      message: 'The receipt is too small to read reliably. Retake it closer to the receipt.',
    });
  } else if (shortEdge < 900) {
    issues.push({
      code: 'low-resolution',
      severity: 'warning',
      message: 'Fine receipt text may be difficult to recognize at this resolution.',
    });
  }

  if (image.fileSize !== null && pixels >= 1_000_000 && image.fileSize < 45_000) {
    issues.push({
      code: 'extreme-compression',
      severity: 'warning',
      message: 'The image is heavily compressed. Check small prices and item names before continuing.',
    });
  }

  if (longToShort > 7) {
    issues.push({
      code: 'very-long-receipt',
      severity: 'warning',
      message: 'This is a very long receipt. Recora will preserve text resolution and may process it more slowly.',
    });
  }

  if (!manual.readableAndComplete) {
    issues.push({
      code: 'readability-confirmation',
      severity: 'blocker',
      message:
        'Confirm that text is sharp, lighting is clear, and the full receipt including the final total is visible.',
    });
  }

  return {
    canContinue: !issues.some((issue) => issue.severity === 'blocker'),
    issues,
  };
}
