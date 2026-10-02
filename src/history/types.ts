import type {
  AdjustmentKind,
  TransactionType,
  ValidationState,
} from '../domain/receipt';

export interface HistoryFilters {
  query?: string;
  merchantQuery?: string;
  categoryId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  limit?: number;
}

export interface ReceiptHistoryEntry {
  receiptId: string;
  merchantName: string | null;
  purchasedAt: string | null;
  totalMinor: number | null;
  currencyCode: string;
  transactionType: TransactionType;
  validationState: ValidationState;
  itemCount: number;
}

export interface HistoryLineItem {
  lineItemId: string;
  receiptId: string;
  position: number;
  rawName: string;
  normalizedItemId: string | null;
  normalizedName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  quantityMilli: number | null;
  unitPriceMinor: number | null;
  lineTotalMinor: number | null;
  reviewState: ValidationState;
}

export interface HistoryAdjustment {
  id: string;
  kind: AdjustmentKind;
  label: string;
  amountMinor: number;
}

export interface ReceiptHistoryDetail {
  receiptId: string;
  merchantName: string | null;
  purchasedAt: string | null;
  subtotalMinor: number | null;
  totalMinor: number | null;
  currencyCode: string;
  transactionType: TransactionType;
  validationState: ValidationState;
  imageUri: string | null;
  rawOcrText: string | null;
  items: HistoryLineItem[];
  adjustments: HistoryAdjustment[];
}

export interface ItemSearchEntry extends HistoryLineItem {
  merchantName: string | null;
  purchasedAt: string | null;
  currencyCode: string;
}

export interface ItemHistoryPoint {
  lineItemId: string;
  receiptId: string;
  rawName: string;
  normalizedItemId: string | null;
  normalizedName: string | null;
  merchantName: string | null;
  purchasedAt: string | null;
  quantityMilli: number | null;
  unitPriceMinor: number | null;
  lineTotalMinor: number | null;
  currencyCode: string;
}

export interface ItemHistorySummary {
  identity: {
    normalizedItemId: string | null;
    normalizedName: string | null;
    rawName: string | null;
  };
  purchaseCount: number;
  firstPurchasedAt: string | null;
  lastPurchasedAt: string | null;
  latestUnitPriceMinor: number | null;
  points: ItemHistoryPoint[];
}

export interface NormalizedItemOption {
  id: string;
  canonicalName: string;
  categoryId: string | null;
  categoryName: string | null;
}

export interface CategoryOption {
  id: string;
  name: string;
  icon: string | null;
}

export interface AcceptedLineItemContext {
  lineItemId: string;
  receiptId: string;
  rawName: string;
  normalizedItemId: string | null;
  merchantId: string | null;
  merchantRawName: string | null;
}

export interface CorrectionRuleRecord {
  id: string;
  merchantId: string;
  pattern: string;
  correction: string;
  normalizedItemId: string | null;
  enabled: boolean;
}
