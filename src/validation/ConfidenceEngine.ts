import type { ReceiptCandidate } from '../parser/types';
import type {
  ConfidenceReason,
  FieldConfidence,
  ObservationConfidenceMap,
  ValidationIssue,
} from './types';

const MAX_BASIS_POINTS = 10_000;
const MIN_BASIS_POINTS = 0;

export function computeReceiptConfidence(
  candidate: ReceiptCandidate,
  issues: readonly ValidationIssue[],
  observations: ObservationConfidenceMap = new Map(),
): FieldConfidence[] {
  const fields: FieldConfidence[] = [];

  fields.push(
    assessField(
      'receipt.merchant',
      candidate.merchant?.observationIds ?? [],
      candidate.merchant ? 7200 : 2500,
      issues,
      observations,
    ),
  );

  fields.push(
    assessField(
      'receipt.date',
      candidate.date?.observationIds ?? [],
      candidate.date
        ? candidate.date.ambiguous || !candidate.date.isoDateTime
          ? 3800
          : 8200
        : 2500,
      issues,
      observations,
    ),
  );

  fields.push(
    assessField(
      'receipt.subtotal',
      candidate.summary.subtotalSourceIds,
      candidate.summary.subtotalMinor === null ? 5200 : 8200,
      issues,
      observations,
    ),
  );

  fields.push(
    assessField(
      'receipt.total',
      candidate.summary.totalSourceIds,
      candidate.summary.totalMinor === null ? 1800 : 8600,
      issues,
      observations,
    ),
  );

  for (const item of candidate.items) {
    const fieldPath = `items.${item.id}`;
    let base = item.lineTotalMinor === null ? 2800 : 7200;

    if (item.quantityMilli !== null && item.unitPriceMinor !== null) {
      base += 700;
    }
    if (item.possibleDuplicateOf) {
      base -= 1800;
    }

    fields.push(
      assessField(
        fieldPath,
        item.observationIds,
        base,
        issues,
        observations,
      ),
    );
  }

  for (const adjustment of candidate.summary.adjustments) {
    fields.push(
      assessField(
        `adjustments.${adjustment.id}`,
        adjustment.observationIds,
        7600,
        issues,
        observations,
      ),
    );
  }

  return fields;
}

function assessField(
  fieldPath: string,
  observationIds: readonly string[],
  structuralBase: number,
  issues: readonly ValidationIssue[],
  observations: ObservationConfidenceMap,
): FieldConfidence {
  const reasons: ConfidenceReason[] = [
    {
      signal: 'parser-structure',
      deltaBasisPoints: structuralBase - 5000,
      description: 'Confidence from the parser structure and available field evidence.',
    },
  ];

  let score = structuralBase;
  const ocrValues = observationIds
    .map((id) => observations.get(id))
    .filter((value): value is number => value !== null && value !== undefined)
    .map(normalizeOcrConfidence);

  const ocrConfidenceBasisPoints =
    ocrValues.length === 0
      ? null
      : Math.round(ocrValues.reduce((sum, value) => sum + value, 0) / ocrValues.length);

  if (ocrConfidenceBasisPoints !== null) {
    const delta = Math.round((ocrConfidenceBasisPoints - 5000) * 0.25);
    score += delta;
    reasons.push({
      signal: 'ocr-confidence',
      deltaBasisPoints: delta,
      description: 'Native OCR confidence was available for the supporting observations.',
    });
  }

  const fieldIssues = issues.filter(
    (issue) =>
      issue.fieldPath === fieldPath ||
      issue.fieldPath.startsWith(`${fieldPath}.`),
  );

  for (const issue of fieldIssues) {
    const delta = issue.state === 'mismatch' ? -3500 : -1800;
    score += delta;
    reasons.push({
      signal:
        issue.code.includes('arithmetic') ||
        issue.code === 'subtotal-mismatch' ||
        issue.code === 'total-mismatch'
          ? 'arithmetic'
          : issue.code === 'possible-duplicate-line'
            ? 'duplicate'
            : issue.code.startsWith('missing')
              ? 'missing-value'
              : 'ambiguity',
      deltaBasisPoints: delta,
      description: issue.message,
    });
  }

  return {
    fieldPath,
    confidenceBasisPoints: clamp(Math.round(score)),
    ocrConfidenceBasisPoints,
    reasons,
  };
}

function normalizeOcrConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 5000;
  }

  if (value >= 0 && value <= 1) {
    return Math.round(value * MAX_BASIS_POINTS);
  }

  if (value >= 0 && value <= 100) {
    return Math.round(value * 100);
  }

  return clamp(Math.round(value));
}

function clamp(value: number): number {
  return Math.max(MIN_BASIS_POINTS, Math.min(MAX_BASIS_POINTS, value));
}
