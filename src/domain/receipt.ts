export const RECEIPT_STATUSES = ['draft', 'processing', 'review', 'accepted'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const VALIDATION_STATES = ['verified', 'review', 'mismatch'] as const;
export type ValidationState = (typeof VALIDATION_STATES)[number];

export const TRANSACTION_TYPES = ['purchase', 'return', 'refund', 'unknown'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const ADJUSTMENT_KINDS = ['discount', 'tax', 'service', 'rounding', 'other'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export interface Receipt {
  id: string;
  merchantId: string | null;
  merchantRawName: string | null;
  purchasedAt: string | null;
  subtotalMinor: number | null;
  totalMinor: number | null;
  currencyCode: string;
  transactionType: TransactionType;
  status: ReceiptStatus;
  validationState: ValidationState;
  imageUri: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  rawOcrText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LineItem {
  id: string;
  receiptId: string;
  position: number;
  rawName: string;
  normalizedItemId: string | null;
  categoryId: string | null;
  quantityMilli: number | null;
  rawQuantityText: string | null;
  unitPriceMinor: number | null;
  lineTotalMinor: number | null;
  confidenceBasisPoints: number | null;
  reviewState: ValidationState;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptAdjustment {
  id: string;
  receiptId: string;
  position: number;
  kind: AdjustmentKind;
  label: string;
  amountMinor: number;
  confidenceBasisPoints: number | null;
  reviewState: ValidationState;
}
