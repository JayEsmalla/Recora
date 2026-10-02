import type { StoredReceiptReview } from '../data/repositories/ReceiptRepository';
import { parseMajorAmountToMinor } from '../domain/money';
import type { ReceiptCandidate } from '../parser/types';
import { parseDateText } from '../parser/receiptDates';
import { validateReceiptCandidate } from '../validation/ValidationEngine';
import type { ReviewDraft, ReviewEvaluation, ReviewInputError } from './types';

export function createReviewDraft(
  candidate: ReceiptCandidate,
  receiptId: string,
): ReviewDraft {
  return {
    merchantName: candidate.merchant?.rawName ?? '',
    purchasedAtText: candidate.date?.isoDateTime ?? candidate.date?.raw ?? '',
    subtotalText: formatEditableMoney(candidate.summary.subtotalMinor),
    totalText: formatEditableMoney(candidate.summary.totalMinor),
    transactionType: candidate.transactionType,
    items: candidate.items.map((item) => ({
      id: `${receiptId}-${item.id}`,
      rawName: item.rawName,
      quantityText:
        item.quantityMilli === null ? '' : formatQuantityMilli(item.quantityMilli),
      unitPriceText: formatEditableMoney(item.unitPriceMinor),
      lineTotalText: formatEditableMoney(item.lineTotalMinor),
      observationIds: [...item.observationIds],
    })),
    adjustments: candidate.summary.adjustments.map((adjustment) => ({
      id: `${receiptId}-${adjustment.id}`,
      kind: adjustment.kind,
      label: adjustment.label,
      amountText: formatEditableMoney(adjustment.amountMinor),
      observationIds: [...adjustment.observationIds],
    })),
  };
}

export function createReviewDraftFromStored(
  stored: StoredReceiptReview,
): ReviewDraft {
  return {
    merchantName: stored.receipt.merchantRawName ?? '',
    purchasedAtText: stored.receipt.purchasedAt ?? '',
    subtotalText: formatEditableMoney(stored.receipt.subtotalMinor),
    totalText: formatEditableMoney(stored.receipt.totalMinor),
    transactionType: stored.receipt.transactionType,
    items: stored.lineItems.map((item) => ({
      id: item.id,
      rawName: item.rawName,
      quantityText:
        item.quantityMilli === null ? '' : formatQuantityMilli(item.quantityMilli),
      unitPriceText: formatEditableMoney(item.unitPriceMinor),
      lineTotalText: formatEditableMoney(item.lineTotalMinor),
      observationIds: [],
    })),
    adjustments: stored.adjustments.map((adjustment) => ({
      id: adjustment.id,
      kind: adjustment.kind,
      label: adjustment.label,
      amountText: formatEditableMoney(adjustment.amountMinor),
      observationIds: [],
    })),
  };
}

export function evaluateReviewDraft(
  draft: ReviewDraft,
  now = new Date(),
): ReviewEvaluation {
  const inputErrors: ReviewInputError[] = [];
  const candidate = reviewDraftToCandidate(draft, inputErrors);

  return {
    validation: validateReceiptCandidate(candidate, { now }),
    inputErrors,
  };
}

export function reviewDraftToCandidate(
  draft: ReviewDraft,
  inputErrors: ReviewInputError[] = [],
): ReceiptCandidate {
  const parsedDate = parseReviewDate(draft.purchasedAtText);
  const subtotalMinor = parseOptionalMoney(
    draft.subtotalText,
    'receipt.subtotal',
    inputErrors,
  );
  const totalMinor = parseOptionalMoney(
    draft.totalText,
    'receipt.total',
    inputErrors,
  );

  const seen = new Map<string, string>();

  return {
    parserVersion: 'manual-review',
    merchant: draft.merchantName.trim()
      ? { rawName: draft.merchantName.trim(), observationIds: [] }
      : null,
    date: parsedDate,
    transactionType: draft.transactionType,
    items: draft.items.map((item, position) => {
      const rawName = item.rawName.trim();
      if (!rawName) {
        inputErrors.push({
          fieldPath: `items.${item.id}.name`,
          message: 'Enter an item name or remove this row.',
        });
      }

      const quantityMilli = parseOptionalQuantity(
        item.quantityText,
        `items.${item.id}.quantity`,
        inputErrors,
      );
      const unitPriceMinor = parseOptionalMoney(
        item.unitPriceText,
        `items.${item.id}.unitPrice`,
        inputErrors,
      );
      const lineTotalMinor = parseOptionalMoney(
        item.lineTotalText,
        `items.${item.id}.lineTotal`,
        inputErrors,
      );

      const key = duplicateKey(rawName, lineTotalMinor);
      const possibleDuplicateOf = seen.get(key) ?? null;
      if (!possibleDuplicateOf) {
        seen.set(key, item.id);
      }

      return {
        id: item.id,
        position,
        rawName,
        quantityMilli,
        rawQuantityText: item.quantityText.trim() || null,
        unitPriceMinor,
        lineTotalMinor,
        possibleDuplicateOf,
        observationIds: [...item.observationIds],
      };
    }),
    summary: {
      subtotalMinor,
      subtotalSourceIds: [],
      totalMinor,
      totalSourceIds: [],
      adjustments: draft.adjustments.map((adjustment, position) => ({
        id: adjustment.id,
        position,
        kind: adjustment.kind,
        label: adjustment.label.trim() || adjustment.kind,
        amountMinor:
          parseRequiredMoney(
            adjustment.amountText,
            `adjustments.${adjustment.id}.amount`,
            inputErrors,
          ) ?? 0,
        observationIds: [...adjustment.observationIds],
      })),
    },
    warnings: [],
  };
}

export function createBlankReviewItem(
  receiptId: string,
  index: number,
): ReviewDraft['items'][number] {
  return {
    id: `${receiptId}-manual-item-${Date.now()}-${index}`,
    rawName: '',
    quantityText: '',
    unitPriceText: '',
    lineTotalText: '',
    observationIds: [],
  };
}

export function createBlankAdjustment(
  receiptId: string,
  index: number,
): ReviewDraft['adjustments'][number] {
  return {
    id: `${receiptId}-manual-adjustment-${Date.now()}-${index}`,
    kind: 'discount',
    label: 'Discount',
    amountText: '',
    observationIds: [],
  };
}

export function formatEditableMoney(value: number | null): string {
  if (value === null) {
    return '';
  }

  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(
    absolute % 100,
  ).padStart(2, '0')}`;
}

function formatQuantityMilli(value: number): string {
  const whole = Math.trunc(value / 1000);
  const remainder = Math.abs(value % 1000);

  if (remainder === 0) {
    return String(whole);
  }

  return `${whole}.${String(remainder)
    .padStart(3, '0')
    .replace(/0+$/, '')}`;
}

function parseReviewDate(text: string): ReceiptCandidate['date'] {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = parseDateText(trimmed.replace('T', ' '));
  if (parsed) {
    return {
      ...parsed,
      observationIds: [],
    };
  }

  return {
    raw: trimmed,
    isoDateTime: null,
    ambiguous: true,
    observationIds: [],
  };
}

function parseOptionalMoney(
  text: string,
  fieldPath: string,
  errors: ReviewInputError[],
): number | null {
  if (!text.trim()) {
    return null;
  }
  return parseRequiredMoney(text, fieldPath, errors);
}

function parseRequiredMoney(
  text: string,
  fieldPath: string,
  errors: ReviewInputError[],
): number | null {
  try {
    return parseMajorAmountToMinor(text);
  } catch {
    errors.push({
      fieldPath,
      message: 'Enter a valid amount with at most two decimal places.',
    });
    return null;
  }
}

function parseOptionalQuantity(
  text: string,
  fieldPath: string,
  errors: ReviewInputError[],
): number | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^\d+(?:\.\d{1,3})?$/.test(trimmed)) {
    errors.push({
      fieldPath,
      message: 'Enter a positive quantity with at most three decimal places.',
    });
    return null;
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) {
    errors.push({
      fieldPath,
      message: 'Enter a positive quantity.',
    });
    return null;
  }

  return Math.round(value * 1000);
}

function duplicateKey(name: string, lineTotalMinor: number | null): string {
  return [
    name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(),
    lineTotalMinor ?? 'null',
  ].join('|');
}
