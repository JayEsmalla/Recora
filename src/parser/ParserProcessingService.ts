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

    return this.parseRun(run, options);
  }

  parseRun(
    run: StoredOcrRun,
    options?: ReceiptParserOptions,
  ): ReceiptCandidate {
    return parseReceipt(rebuildDocument(run), options);
  }
}

export function rebuildDocument(run: StoredOcrRun): OcrDocument {
  const blocks: StoredOcrObservation[] = [];
  const linesByParent = new Map<string, StoredOcrObservation[]>();
  const elementsByParent = new Map<string, StoredOcrObservation[]>();

  for (const observation of run.observations) {
    if (observation.kind === 'block') {
      blocks.push(observation);
      continue;
    }

    if (!observation.parentId) {
      continue;
    }

    const target =
      observation.kind === 'line' ? linesByParent : elementsByParent;
    const siblings = target.get(observation.parentId);
    if (siblings) {
      siblings.push(observation);
    } else {
      target.set(observation.parentId, [observation]);
    }
  }

  const rebuiltBlocks = blocks
    .sort(byPosition)
    .map((block): OcrBlock => {
      const lines = (linesByParent.get(block.id) ?? [])
        .sort(byPosition)
        .map((line): OcrLine => ({
          id: line.id,
          text: line.text,
          frame: line.frame,
          confidence: line.confidence,
          elements: (elementsByParent.get(line.id) ?? [])
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
    blocks: rebuiltBlocks,
  };
}

function byPosition(
  left: StoredOcrObservation,
  right: StoredOcrObservation,
): number {
  return left.position - right.position;
}
