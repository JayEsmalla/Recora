import type { OcrRepository } from '../data/repositories/OcrRepository';
import type { ReceiptCandidate } from '../parser/types';
import type { ParserProcessingService } from '../parser/ParserProcessingService';
import { validateReceiptCandidate } from './ValidationEngine';
import type { ObservationConfidenceMap, ValidationReport } from './types';

export interface ReceiptAnalysis {
  candidate: ReceiptCandidate;
  validation: ValidationReport;
}

export class ValidationProcessingService {
  constructor(
    private readonly parser: ParserProcessingService,
    private readonly ocr: OcrRepository,
  ) {}

  async analyze(receiptId: string, now = new Date()): Promise<ReceiptAnalysis> {
    const [candidate, run] = await Promise.all([
      this.parser.parseReceipt(receiptId),
      this.ocr.getForReceipt(receiptId),
    ]);

    if (!run) {
      throw new Error('Receipt does not have completed OCR evidence.');
    }

    const observations: ObservationConfidenceMap = new Map(
      run.observations.map((observation) => [
        observation.id,
        observation.confidence,
      ]),
    );

    return {
      candidate,
      validation: validateReceiptCandidate(candidate, {
        now,
        observations,
      }),
    };
  }
}
