import type {
  OcrRepository,
  StoredOcrObservation,
  StoredOcrRun,
} from '../data/repositories/OcrRepository';
import type { OcrBlock, OcrDocument, OcrLine } from '../ocr/types';
import { parseReceipt, type ReceiptParserOptions } from './ReceiptParser';
import type { ReceiptCandidate } from './types';

export class ParserProcessingService {
  constructor(private readonly ocr: OcrRepository) {}

  async parseReceipt(
    receiptId: string,
    options?: ReceiptParserOptions,
  ): Promise<ReceiptCandidate> {
    const run = await this.ocr.getForReceipt(receiptId);
    if (!run) {
      throw new Error('Receipt does not have completed OCR evidence.');
    }

    return parseReceipt(rebuildDocument(run), options);
  }
}

export function rebuildDocument(run: StoredOcrRun): OcrDocument {
  const blocks = run.observations
    .filter((item) => item.kind === 'block')
    .sort(byPosition)
    .map((block): OcrBlock => {
      const lines = run.observations
        .filter((item) => item.kind === 'line' && item.parentId === block.id)
        .sort(byPosition)
        .map((line): OcrLine => ({
          id: line.id,
          text: line.text,
          frame: line.frame,
          confidence: line.confidence,
          elements: run.observations
            .filter(
              (item) => item.kind === 'element' && item.parentId === line.id,
            )
            .sort(byPosition)
            .map((element) => ({
              id: element.id,
              text: element.text,
              frame: element.frame,
              confidence: element.confidence,
            })),
        }));

      return {
        id: block.id,
        text: block.text,
        frame: block.frame,
        confidence: block.confidence,
        lines,
      };
    });

  return {
    engine: run.engine,
    imageWidth: run.imageWidth,
    imageHeight: run.imageHeight,
    rawText: run.rawText,
    blocks,
  };
}

function byPosition(
  left: StoredOcrObservation,
  right: StoredOcrObservation,
): number {
  return left.position - right.position;
}
