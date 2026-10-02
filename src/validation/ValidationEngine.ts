import type { ValidationState } from '../domain/receipt';
import type { ReceiptCandidate } from '../parser/types';
import { computeReceiptConfidence } from './ConfidenceEngine';
import type {
  ObservationConfidenceMap,
  ValidationCounters,
  ValidationIssue,
  ValidationReport,
} from './types';

export interface ValidateReceiptOptions {
  now?: Date;
  observations?: ObservationConfidenceMap;
  arithmeticToleranceMinor?: number;
}

export function validateReceiptCandidate(
  candidate: ReceiptCandidate,
  options: ValidateReceiptOptions = {},
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const counters: ValidationCounters = {
    lineArithmeticChecked: 0,
    lineArithmeticMismatches: 0,
    subtotalChecks: 0,
    subtotalMismatches: 0,
    totalChecks: 0,
    totalMismatches: 0,
  };
  const tolerance = Math.max(0, Math.trunc(options.arithmeticToleranceMinor ?? 1));

  validateCriticalFields(candidate, issues, options.now ?? new Date());
  validateParserWarnings(candidate, issues);
  validateLineItems(candidate, issues, counters, tolerance);
  validateSummary(candidate, issues, counters, tolerance);

  const state = overallState(issues);

  return {
    state,
    issues,
    confidence: computeReceiptConfidence(
      candidate,
      issues,
      options.observations,
    ),
    counters,
  };
}

function validateCriticalFields(
  candidate: ReceiptCandidate,
  issues: ValidationIssue[],
  now: Date,
): void {
  if (!candidate.merchant) {
    issues.push({
      code: 'missing-merchant',
      state: 'review',
      fieldPath: 'receipt.merchant',
      message: 'Merchant name was not reconstructed and needs review.',
      observationIds: [],
    });
  }

  if (!candidate.date) {
    issues.push({
      code: 'missing-date',
      state: 'review',
      fieldPath: 'receipt.date',
      message: 'Purchase date was not reconstructed and needs review.',
      observationIds: [],
    });
  } else if (candidate.date.ambiguous || !candidate.date.isoDateTime) {
    issues.push({
      code: 'ambiguous-date',
      state: 'review',
      fieldPath: 'receipt.date',
      message: 'Purchase date is ambiguous or malformed.',
      observationIds: candidate.date.observationIds,
    });
  } else {
    const parsed = parseLocalDate(candidate.date.isoDateTime);
    if (parsed === null) {
      issues.push({
        code: 'ambiguous-date',
        state: 'review',
        fieldPath: 'receipt.date',
        message: 'Purchase date is not a valid local date/time.',
        observationIds: candidate.date.observationIds,
      });
    } else {
      const futureLimit = now.getTime() + 24 * 60 * 60 * 1000;
      if (parsed > futureLimit) {
        issues.push({
          code: 'future-date',
          state: 'review',
          fieldPath: 'receipt.date',
          message: 'Purchase date is unexpectedly in the future.',
          observationIds: candidate.date.observationIds,
        });
      }
    }
  }

  if (candidate.summary.totalMinor === null) {
    issues.push({
      code: 'missing-total',
      state: 'mismatch',
      fieldPath: 'receipt.total',
      message: 'A final receipt total is required before this receipt can be verified.',
      observationIds: candidate.summary.totalSourceIds,
    });
  }

  if (candidate.items.length === 0) {
    issues.push({
      code: 'missing-items',
      state: 'mismatch',
      fieldPath: 'items',
      message: 'No purchase items were reconstructed from the receipt.',
      observationIds: [],
    });
  }
}

function validateParserWarnings(
  candidate: ReceiptCandidate,
  issues: ValidationIssue[],
): void {
  for (const warning of candidate.warnings) {
    if (warning.code === 'ambiguous-date') {
      continue;
    }

    const duplicateItem = candidate.items.find((item) =>
      item.observationIds.some((id) => warning.observationIds.includes(id)),
    );

    issues.push({
      code:
        warning.code === 'possible-duplicate-line'
          ? 'possible-duplicate-line'
          : 'parser-warning',
      state: 'review',
      fieldPath: duplicateItem ? `items.${duplicateItem.id}` : 'receipt',
      message: warning.message,
      observationIds: warning.observationIds,
    });
  }
}

function validateLineItems(
  candidate: ReceiptCandidate,
  issues: ValidationIssue[],
  counters: ValidationCounters,
  tolerance: number,
): void {
  const seen = new Map<string, string>();

  for (const item of candidate.items) {
    const fieldPath = `items.${item.id}`;

    if (!item.rawName.trim()) {
      issues.push({
        code: 'missing-item-name',
        state: 'mismatch',
        fieldPath,
        message: 'Item name is required before this receipt can be accepted.',
        observationIds: item.observationIds,
      });
    }

    if (item.lineTotalMinor === null) {
      issues.push({
        code: 'missing-line-total',
        state: 'mismatch',
        fieldPath,
        message: 'Item line total is required before this receipt can be accepted.',
        observationIds: item.observationIds,
      });
    }

    const duplicateKey = [
      item.rawName.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(),
      item.lineTotalMinor ?? 'null',
    ].join('|');
    const duplicateOf = seen.get(duplicateKey);

    if (
      duplicateOf &&
      !issues.some(
        (issue) =>
          issue.code === 'possible-duplicate-line' &&
          issue.fieldPath === fieldPath,
      )
    ) {
      issues.push({
        code: 'possible-duplicate-line',
        state: 'review',
        fieldPath,
        message: `"${item.rawName}" duplicates another item name and amount; confirm both rows are real purchases.`,
        observationIds: item.observationIds,
      });
    } else if (!duplicateOf) {
      seen.set(duplicateKey, item.id);
    }

    if (
      candidate.transactionType === 'purchase' &&
      item.lineTotalMinor !== null &&
      item.lineTotalMinor <= 0
    ) {
      issues.push({
        code: 'unexpected-line-value',
        state: 'review',
        fieldPath,
        message: 'Purchase item has a zero or negative line total.',
        observationIds: item.observationIds,
        actualMinor: item.lineTotalMinor,
      });
    }

    if (
      item.quantityMilli === null ||
      item.unitPriceMinor === null ||
      item.lineTotalMinor === null
    ) {
      continue;
    }

    counters.lineArithmeticChecked += 1;
    const expected = Math.round(
      (item.quantityMilli * item.unitPriceMinor) / 1000,
    );

    if (!withinTolerance(expected, item.lineTotalMinor, tolerance)) {
      counters.lineArithmeticMismatches += 1;
      issues.push({
        code: 'line-arithmetic-mismatch',
        state: 'mismatch',
        fieldPath,
        message: `Quantity × unit price does not match the reconstructed line total for "${item.rawName}".`,
        observationIds: item.observationIds,
        expectedMinor: expected,
        actualMinor: item.lineTotalMinor,
      });
    }
  }
}

function validateSummary(
  candidate: ReceiptCandidate,
  issues: ValidationIssue[],
  counters: ValidationCounters,
  tolerance: number,
): void {
  const lineTotals = candidate.items
    .map((item) => item.lineTotalMinor)
    .filter((value): value is number => value !== null);

  if (
    candidate.summary.subtotalMinor !== null &&
    lineTotals.length === candidate.items.length &&
    candidate.items.length > 0
  ) {
    counters.subtotalChecks += 1;
    const expectedSubtotal = lineTotals.reduce((sum, value) => sum + value, 0);

    if (
      !withinTolerance(
        expectedSubtotal,
        candidate.summary.subtotalMinor,
        tolerance,
      )
    ) {
      counters.subtotalMismatches += 1;
      issues.push({
        code: 'subtotal-mismatch',
        state: 'mismatch',
        fieldPath: 'receipt.subtotal',
        message: 'Sum of reconstructed item totals does not match the receipt subtotal.',
        observationIds: candidate.summary.subtotalSourceIds,
        expectedMinor: expectedSubtotal,
        actualMinor: candidate.summary.subtotalMinor,
      });
    }
  }

  if (candidate.summary.totalMinor === null) {
    return;
  }

  const base =
    candidate.summary.subtotalMinor ??
    (lineTotals.length === candidate.items.length && candidate.items.length > 0
      ? lineTotals.reduce((sum, value) => sum + value, 0)
      : null);

  if (base === null) {
    return;
  }

  counters.totalChecks += 1;
  const adjustments = candidate.summary.adjustments.reduce(
    (sum, adjustment) => sum + adjustment.amountMinor,
    0,
  );
  const expectedTotal = base + adjustments;

  if (!withinTolerance(expectedTotal, candidate.summary.totalMinor, tolerance)) {
    counters.totalMismatches += 1;
    issues.push({
      code: 'total-mismatch',
      state: 'mismatch',
      fieldPath: 'receipt.total',
      message:
        'Subtotal/items plus discounts, taxes, service charges, and rounding do not reconcile to the final total.',
      observationIds: candidate.summary.totalSourceIds,
      expectedMinor: expectedTotal,
      actualMinor: candidate.summary.totalMinor,
    });
  }
}

function overallState(issues: readonly ValidationIssue[]): ValidationState {
  if (issues.some((issue) => issue.state === 'mismatch')) {
    return 'mismatch';
  }
  if (issues.some((issue) => issue.state === 'review')) {
    return 'review';
  }
  return 'verified';
}

function withinTolerance(
  expected: number,
  actual: number,
  tolerance: number,
): boolean {
  return Math.abs(expected - actual) <= tolerance;
}

function parseLocalDate(value: string): number | null {
  const normalized = value.length === 10 ? `${value}T00:00:00` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}
