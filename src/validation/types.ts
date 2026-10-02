import type { ValidationState } from '../domain/receipt';

export type ValidationIssueCode =
  | 'missing-merchant'
  | 'missing-date'
  | 'ambiguous-date'
  | 'future-date'
  | 'missing-total'
  | 'missing-items'
  | 'missing-item-name'
  | 'missing-line-total'
  | 'line-arithmetic-mismatch'
  | 'subtotal-mismatch'
  | 'total-mismatch'
  | 'unexpected-line-value'
  | 'possible-duplicate-line'
  | 'parser-warning';

export interface ValidationIssue {
  code: ValidationIssueCode;
  state: Exclude<ValidationState, 'verified'>;
  fieldPath: string;
  message: string;
  observationIds: string[];
  expectedMinor?: number;
  actualMinor?: number;
}

export interface ConfidenceReason {
  signal:
    | 'parser-structure'
    | 'ocr-confidence'
    | 'arithmetic'
    | 'ambiguity'
    | 'duplicate'
    | 'missing-value';
  deltaBasisPoints: number;
  description: string;
}

export interface FieldConfidence {
  fieldPath: string;
  confidenceBasisPoints: number;
  ocrConfidenceBasisPoints: number | null;
  reasons: ConfidenceReason[];
}

export interface ValidationCounters {
  lineArithmeticChecked: number;
  lineArithmeticMismatches: number;
  subtotalChecks: number;
  subtotalMismatches: number;
  totalChecks: number;
  totalMismatches: number;
}

export interface ValidationReport {
  state: ValidationState;
  issues: ValidationIssue[];
  confidence: FieldConfidence[];
  counters: ValidationCounters;
}

export type ObservationConfidenceMap = ReadonlyMap<string, number | null>;
