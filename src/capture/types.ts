export interface ReceiptImageSource {
  uri: string;
  width: number;
  height: number;
  fileSize: number | null;
  origin: 'camera' | 'library' | 'recovered';
}

export interface NormalizedCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PreparedReceiptImage {
  uri: string;
  width: number;
  height: number;
  fileSize: number | null;
  cropCoverage: number;
}

export interface ManualQualityChecks {
  sharpText: boolean;
  evenLighting: boolean;
  fullyVisible: boolean;
}

export type QualitySeverity = 'warning' | 'blocker';

export interface QualityIssue {
  code:
    | 'low-resolution'
    | 'tiny-image'
    | 'extreme-compression'
    | 'very-long-receipt'
    | 'blur-confirmation'
    | 'lighting-confirmation'
    | 'framing-confirmation';
  severity: QualitySeverity;
  message: string;
}

export interface QualityAssessment {
  canContinue: boolean;
  issues: QualityIssue[];
}
