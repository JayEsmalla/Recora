import type { OcrDocument, OcrLine } from '../ocr/types';
import {
  extractAmountTokens,
  parseReceiptAmount,
  rightmostAmount,
} from './receiptAmounts';
import { findDateCandidate } from './receiptDates';
import {
  flattenReceiptLines,
  lettersRatio,
  normalizeReceiptText,
} from './receiptLines';
import type {
  ParsedAdjustmentCandidate,
  ParsedLineItemCandidate,
  ParsedMerchantCandidate,
  ParserWarning,
  ReceiptCandidate,
  ReceiptSummaryCandidate,
} from './types';

const PARSER_VERSION = '1.0.0';

const SUBTOTAL_PATTERN = /\bSUB\s*-?\s*TOTAL\b/i;
const TOTAL_PATTERN =
  /\b(?:GRAND\s+TOTAL|TOTAL\s+(?:AMOUNT|DUE)|AMOUNT\s+DUE|NET\s+TOTAL|TOTAL)\b/i;
const DISCOUNT_PATTERN =
  /\b(?:DISCOUNT|DISC\.?|PROMO|COUPON|LESS|SENIOR|PWD)\b/i;
const TAX_PATTERN = /\b(?:VAT|TAX|EVAT)\b/i;
const SERVICE_PATTERN = /\b(?:SERVICE\s+CHARGE|SVC\s+CHARGE|SERVICE)\b/i;
const ROUNDING_PATTERN = /\b(?:ROUND(?:ING)?|RND)\b/i;
const REFUND_PATTERN = /\b(?:REFUND|RETURN(?:ED)?)\b/i;
const TOTAL_ITEMS_PATTERN = /\b(?:TOTAL\s+ITEMS?|ITEM\s+COUNT)\b/i;
const QUANTITY_PATTERN =
  /(?:^|\s)(\d+(?:\.\d{1,3})?)\s*(?:@|[xX×])\s*(?:PHP\s*|₱\s*)?(-?\d[\d,]*(?:\.\d{1,2})?)/i;

const NON_ITEM_PATTERN =
  /\b(?:CASHIER|TERMINAL|INVOICE|RECEIPT|OR\s*NO|SI\s*NO|TIN|VAT\s*REG|TEL|PHONE|CONTACT|CHANGE|CASH|TENDER|PAYMENT|CARD|AUTH|TRACE|REFERENCE|REF\s*NO|CUSTOMER|THANK\s+YOU|DATE|TIME)\b/i;

export interface MerchantParserProfile {
  id: string;
  merchantPatterns: readonly RegExp[];
  ignoredLinePatterns?: readonly RegExp[];
}

export interface ReceiptParserOptions {
  profiles?: readonly MerchantParserProfile[];
}

interface ParsedSummaryLine {
  line: OcrLine;
  type: 'subtotal' | 'total' | 'adjustment';
  adjustment?: ParsedAdjustmentCandidate;
  amountMinor: number | null;
}

export function parseReceipt(
  document: OcrDocument,
  options: ReceiptParserOptions = {},
): ReceiptCandidate {
  const lines = flattenReceiptLines(document);
  const date = findDateCandidate(lines);
  const activeProfile = findMerchantProfile(lines, options.profiles ?? []);
  const ignoredPatterns = activeProfile?.ignoredLinePatterns ?? [];
  const summaryLines = classifySummaryLines(lines);
  const warnings: ParserWarning[] = [];

  const summary = buildSummary(summaryLines, warnings);
  const summaryStartY = findSummaryStartY(summaryLines);
  const merchant = findMerchantCandidate(
    lines,
    document.imageHeight,
    date?.observationIds[0] ?? null,
    ignoredPatterns,
  );
  const items = parseLineItems(
    lines,
    summaryLines,
    summaryStartY,
    date?.observationIds[0] ?? null,
    merchant?.observationIds[0] ?? null,
    ignoredPatterns,
    warnings,
  );

  if (date?.ambiguous) {
    warnings.push({
      code: 'ambiguous-date',
      message: `Receipt date "${date.raw}" is ambiguous and requires review.`,
      observationIds: date.observationIds,
    });
  }

  return {
    parserVersion: PARSER_VERSION,
    merchant,
    date,
    transactionType: detectTransactionType(lines),
    items,
    summary,
    warnings,
  };
}

function findMerchantProfile(
  lines: readonly OcrLine[],
  profiles: readonly MerchantParserProfile[],
): MerchantParserProfile | null {
  for (const profile of profiles) {
    const matches = lines
      .slice(0, 8)
      .some((line) =>
        profile.merchantPatterns.some((pattern) => testPattern(pattern, line.text)),
      );
    if (matches) {
      return profile;
    }
  }
  return null;
}

function findMerchantCandidate(
  lines: readonly OcrLine[],
  imageHeight: number,
  dateObservationId: string | null,
  ignoredPatterns: readonly RegExp[],
): ParsedMerchantCandidate | null {
  const topLimit = imageHeight * 0.3;

  const candidates = lines
    .filter((line) => line.frame.y <= topLimit)
    .filter((line) => line.id !== dateObservationId)
    .filter((line) => !isSummaryText(line.text))
    .filter((line) => !NON_ITEM_PATTERN.test(line.text))
    .filter(
      (line) =>
        !ignoredPatterns.some((pattern) => testPattern(pattern, line.text)),
    )
    .map((line) => ({
      line,
      text: normalizeReceiptText(line.text),
    }))
    .filter(({ text }) => text.length >= 2 && lettersRatio(text) >= 0.45)
    .sort((left, right) => {
      const leftScore = merchantScore(left.line, left.text, imageHeight);
      const rightScore = merchantScore(right.line, right.text, imageHeight);
      return rightScore - leftScore;
    });

  const best = candidates[0];
  if (!best) {
    return null;
  }

  return {
    rawName: best.text,
    observationIds: [best.line.id],
  };
}

function merchantScore(line: OcrLine, text: string, imageHeight: number): number {
  const topness = 1 - Math.min(1, line.frame.y / Math.max(1, imageHeight * 0.3));
  const letterScore = lettersRatio(text);
  const lengthScore = Math.min(1, text.length / 24);
  return topness * 3 + letterScore * 2 + lengthScore;
}

function classifySummaryLines(lines: readonly OcrLine[]): ParsedSummaryLine[] {
  const classified: ParsedSummaryLine[] = [];

  lines.forEach((line, index) => {
    const text = normalizeReceiptText(line.text);
    const amount = rightmostAmount(text);

    if (TOTAL_ITEMS_PATTERN.test(text)) {
      return;
    }

    if (SUBTOTAL_PATTERN.test(text)) {
      classified.push({
        line,
        type: 'subtotal',
        amountMinor: amount?.minor ?? null,
      });
      return;
    }

    const adjustmentKind = detectAdjustmentKind(text);
    if (adjustmentKind) {
      const amountMinor = amount?.minor ?? null;
      classified.push({
        line,
        type: 'adjustment',
        amountMinor,
        adjustment:
          amountMinor === null
            ? undefined
            : {
                id: `adjustment-${index}`,
                position: index,
                kind: adjustmentKind,
                label: stripAmount(text, amount),
                amountMinor:
                  adjustmentKind === 'discount' && amountMinor > 0
                    ? -amountMinor
                    : amountMinor,
                observationIds: [line.id],
              },
      });
      return;
    }

    if (TOTAL_PATTERN.test(text) && !SUBTOTAL_PATTERN.test(text)) {
      classified.push({
        line,
        type: 'total',
        amountMinor: amount?.minor ?? null,
      });
    }
  });

  return classified;
}

function buildSummary(
  lines: readonly ParsedSummaryLine[],
  warnings: ParserWarning[],
): ReceiptSummaryCandidate {
  const subtotals = lines.filter((line) => line.type === 'subtotal');
  const totals = lines.filter((line) => line.type === 'total');
  const adjustmentLines = lines.filter((line) => line.type === 'adjustment');

  for (const line of lines) {
    if (line.amountMinor === null) {
      warnings.push({
        code: 'summary-without-amount',
        message: `Summary line "${normalizeReceiptText(
          line.line.text,
        )}" has no readable amount.`,
        observationIds: [line.line.id],
      });
    }
  }

  const usableTotals = totals.filter(
    (line): line is ParsedSummaryLine & { amountMinor: number } =>
      line.amountMinor !== null,
  );

  if (usableTotals.length > 1) {
    warnings.push({
      code: 'multiple-total-candidates',
      message:
        'Multiple final-total candidates were found. The lowest receipt candidate was selected for review.',
      observationIds: usableTotals.map((line) => line.line.id),
    });
  }

  const subtotal = [...subtotals]
    .reverse()
    .find((line) => line.amountMinor !== null);
  const total = [...usableTotals].sort(
    (left, right) => right.line.frame.y - left.line.frame.y,
  )[0];

  return {
    subtotalMinor: subtotal?.amountMinor ?? null,
    subtotalSourceIds: subtotal ? [subtotal.line.id] : [],
    totalMinor: total?.amountMinor ?? null,
    totalSourceIds: total ? [total.line.id] : [],
    adjustments: adjustmentLines
      .map((line) => line.adjustment)
      .filter(
        (adjustment): adjustment is ParsedAdjustmentCandidate =>
          adjustment !== undefined,
      )
      .map((adjustment, position) => ({ ...adjustment, position })),
  };
}

function findSummaryStartY(lines: readonly ParsedSummaryLine[]): number | null {
  const ys = lines
    .filter((line) => line.type === 'subtotal' || line.type === 'total')
    .map((line) => line.line.frame.y);
  return ys.length > 0 ? Math.min(...ys) : null;
}

function parseLineItems(
  lines: readonly OcrLine[],
  summaryLines: readonly ParsedSummaryLine[],
  summaryStartY: number | null,
  dateObservationId: string | null,
  merchantObservationId: string | null,
  ignoredPatterns: readonly RegExp[],
  warnings: ParserWarning[],
): ParsedLineItemCandidate[] {
  const summaryIds = new Set(summaryLines.map((line) => line.line.id));
  const candidates = lines.filter((line) => {
    if (
      line.id === dateObservationId ||
      line.id === merchantObservationId ||
      summaryIds.has(line.id)
    ) {
      return false;
    }

    if (summaryStartY !== null && line.frame.y >= summaryStartY) {
      return false;
    }

    if (ignoredPatterns.some((pattern) => testPattern(pattern, line.text))) {
      return false;
    }

    return true;
  });

  const items: ParsedLineItemCandidate[] = [];
  let pendingDescription: OcrLine | null = null;

  for (const line of candidates) {
    const text = normalizeReceiptText(line.text);

    if (!text || NON_ITEM_PATTERN.test(text) || parseDateLike(text)) {
      pendingDescription = null;
      continue;
    }

    const amountTokens = extractAmountTokens(text);
    if (amountTokens.length === 0) {
      if (lettersRatio(text) >= 0.5 && text.length >= 2) {
        pendingDescription = line;
      } else {
        pendingDescription = null;
      }
      continue;
    }

    const parsed = parsePricedItemLine(line, items.length);

    if (!parsed) {
      warnings.push({
        code: 'unparsed-priced-line',
        message: `Priced line "${text}" could not be reconstructed safely.`,
        observationIds: [line.id],
      });
      pendingDescription = null;
      continue;
    }

    if (
      pendingDescription &&
      shouldMergePendingDescription(pendingDescription, line, parsed.rawName)
    ) {
      parsed.rawName = `${normalizeReceiptText(
        pendingDescription.text,
      )} ${parsed.rawName}`.trim();
      parsed.observationIds = [pendingDescription.id, line.id];
    }

    const duplicate = items.find(
      (item) =>
        normalizeItemKey(item.rawName) === normalizeItemKey(parsed.rawName) &&
        item.lineTotalMinor === parsed.lineTotalMinor,
    );

    if (duplicate) {
      parsed.possibleDuplicateOf = duplicate.id;
      warnings.push({
        code: 'possible-duplicate-line',
        message: `"${parsed.rawName}" appears more than once with the same amount.`,
        observationIds: parsed.observationIds,
      });
    }

    items.push(parsed);
    pendingDescription = null;
  }

  return items;
}

function parsePricedItemLine(
  line: OcrLine,
  position: number,
): ParsedLineItemCandidate | null {
  const text = normalizeReceiptText(line.text);
  const amounts = extractAmountTokens(text);
  const lineTotal = amounts[amounts.length - 1];

  if (!lineTotal) {
    return null;
  }

  const quantityMatch = text.match(QUANTITY_PATTERN);
  let quantityMilli: number | null = null;
  let rawQuantityText: string | null = null;
  let unitPriceMinor: number | null = null;

  if (quantityMatch) {
    const quantity = Number(quantityMatch[1]);
    const unitPrice = parseReceiptAmount(quantityMatch[2] ?? '');
    if (Number.isFinite(quantity) && quantity > 0 && unitPrice !== null) {
      quantityMilli = Math.round(quantity * 1000);
      rawQuantityText = quantityMatch[0].trim();
      unitPriceMinor = unitPrice;
    }
  }

  let rawName = text.slice(0, lineTotal.start).trim();

  if (quantityMatch && quantityMatch.index !== undefined) {
    rawName = text.slice(0, quantityMatch.index).trim();
  } else if (amounts.length > 1) {
    const possibleUnitPrice = amounts[amounts.length - 2];
    if (possibleUnitPrice) {
      const separator = text.slice(possibleUnitPrice.end, lineTotal.start);
      if (/^[\s|:=-]*$/.test(separator)) {
        rawName = text.slice(0, possibleUnitPrice.start).trim();
        unitPriceMinor = possibleUnitPrice.minor;
      }
    }
  }

  rawName = rawName.replace(/[-–—:]+$/g, '').trim();

  if (!rawName || lettersRatio(rawName) < 0.2) {
    return null;
  }

  return {
    id: `item-${position}`,
    position,
    rawName,
    quantityMilli,
    rawQuantityText,
    unitPriceMinor,
    lineTotalMinor: lineTotal.minor,
    possibleDuplicateOf: null,
    observationIds: [line.id],
  };
}

function shouldMergePendingDescription(
  pending: OcrLine,
  priced: OcrLine,
  pricedName: string,
): boolean {
  const verticalGap =
    priced.frame.y - (pending.frame.y + pending.frame.height);
  const gapLimit = Math.max(pending.frame.height, priced.frame.height) * 1.8;

  if (verticalGap < -2 || verticalGap > gapLimit) {
    return false;
  }

  if (NON_ITEM_PATTERN.test(pending.text) || isSummaryText(pending.text)) {
    return false;
  }

  return pricedName.length <= 22 || /\b(?:EA|PC|PK|KG|G|ML|L)\b/i.test(pricedName);
}

function detectAdjustmentKind(
  text: string,
): ParsedAdjustmentCandidate['kind'] | null {
  if (DISCOUNT_PATTERN.test(text)) {
    return 'discount';
  }
  if (SERVICE_PATTERN.test(text)) {
    return 'service';
  }
  if (TAX_PATTERN.test(text)) {
    return 'tax';
  }
  if (ROUNDING_PATTERN.test(text)) {
    return 'rounding';
  }
  return null;
}

function detectTransactionType(
  lines: readonly OcrLine[],
): ReceiptCandidate['transactionType'] {
  const text = lines.map((line) => line.text).join('\n');
  if (/\bREFUND\b/i.test(text)) {
    return 'refund';
  }
  if (REFUND_PATTERN.test(text)) {
    return 'return';
  }
  return 'purchase';
}

function stripAmount(
  text: string,
  amount: ReturnType<typeof rightmostAmount>,
): string {
  if (!amount) {
    return text;
  }
  return `${text.slice(0, amount.start)}${text.slice(amount.end)}`
    .replace(/[-–—:]+$/g, '')
    .trim();
}

function isSummaryText(text: string): boolean {
  return (
    SUBTOTAL_PATTERN.test(text) ||
    TOTAL_PATTERN.test(text) ||
    detectAdjustmentKind(text) !== null
  );
}

function parseDateLike(text: string): boolean {
  return /\b\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}\b/.test(text);
}

function normalizeItemKey(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function testPattern(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  const result = pattern.test(text);
  pattern.lastIndex = 0;
  return result;
}
