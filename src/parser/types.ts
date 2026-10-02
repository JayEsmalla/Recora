import type { TransactionType } from '../domain/receipt';

export interface SourceTrace {
  observationIds: string[];
}

export interface ParsedDateCandidate extends SourceTrace {
  raw: string;
  isoDateTime: string | null;
  ambiguous: boolean;
}

export interface ParsedMerchantCandidate extends SourceTrace {
  rawName: string;
}

export interface ParsedLineItemCandidate extends SourceTrace {
  id: string;
  position: number;
  rawName: string;
  quantityMilli: number | null;
  rawQuantityText: string | null;
  unitPriceMinor: number | null;
  lineTotalMinor: number | null;
  possibleDuplicateOf: string | null;
}

export type ParsedAdjustmentKind =
  | 'discount'
  | 'tax'
  | 'service'
  | 'rounding'
  | 'other';

export interface ParsedAdjustmentCandidate extends SourceTrace {
  id: string;
  position: number;
  kind: ParsedAdjustmentKind;
  label: string;
  amountMinor: number;
}

export interface ReceiptSummaryCandidate {
  subtotalMinor: number | null;
  subtotalSourceIds: string[];
  totalMinor: number | null;
  totalSourceIds: string[];
  adjustments: ParsedAdjustmentCandidate[];
}

export type ParserWarningCode =
  | 'ambiguous-date'
  | 'possible-duplicate-line'
  | 'multiple-total-candidates'
  | 'summary-without-amount'
  | 'unparsed-priced-line';

export interface ParserWarning {
  code: ParserWarningCode;
  message: string;
  observationIds: string[];
}

export interface ReceiptCandidate {
  parserVersion: string;
  merchant: ParsedMerchantCandidate | null;
  date: ParsedDateCandidate | null;
  transactionType: TransactionType;
  items: ParsedLineItemCandidate[];
  summary: ReceiptSummaryCandidate;
  warnings: ParserWarning[];
}
