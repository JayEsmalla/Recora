import type {
  AdjustmentKind,
  Receipt,
  TransactionType,
} from '../domain/receipt';
import type { ValidationReport } from '../validation/types';

export interface ReviewLineItemDraft {
  id: string;
  rawName: string;
  quantityText: string;
  unitPriceText: string;
  lineTotalText: string;
  observationIds: string[];
}

export interface ReviewAdjustmentDraft {
  id: string;
  kind: AdjustmentKind;
  label: string;
  amountText: string;
  observationIds: string[];
}

export interface ReviewDraft {
  merchantName: string;
  purchasedAtText: string;
  subtotalText: string;
  totalText: string;
  transactionType: TransactionType;
  items: ReviewLineItemDraft[];
  adjustments: ReviewAdjustmentDraft[];
}

export interface ReviewInputError {
  fieldPath: string;
  message: string;
}

export interface ReviewEvaluation {
  validation: ValidationReport;
  inputErrors: ReviewInputError[];
}

export interface ReviewSession {
  receipt: Receipt;
  rawOcrText: string;
  draft: ReviewDraft;
  evaluation: ReviewEvaluation;
}
