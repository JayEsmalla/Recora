import type { ReceiptRepository } from '../data/repositories/ReceiptRepository';
import type {
  OcrRepository,
  StoredOcrRun,
} from '../data/repositories/OcrRepository';
import { redactSensitiveOcr } from './redactSensitiveOcr';
import type { OcrEngine } from './types';

export type OcrProgressStage =
  | 'loading-receipt'
  | 'recognizing-text'
  | 'redacting-sensitive-data'
  | 'persisting-evidence'
  | 'complete';

export interface OcrProgressEvent {
  stage: OcrProgressStage;
  elapsedMs: number;
}

export interface ProcessReceiptOcrInput {
  receiptId: string;
  now?: string;
  signal?: AbortSignal;
  onProgress?: (event: OcrProgressEvent) => void;
}

export class OcrProcessingService {
  constructor(
    private readonly engine: OcrEngine,
    private readonly receipts: ReceiptRepository,
    private readonly ocr: OcrRepository,
  ) {}

  async process(input: ProcessReceiptOcrInput): Promise<StoredOcrRun> {
    const startedAt = Date.now();
    const emit = (stage: OcrProgressStage) => {
      input.onProgress?.({
        stage,
        elapsedMs: Math.max(0, Date.now() - startedAt),
      });
    };

    emit('loading-receipt');
    const receipt = await this.receipts.getById(input.receiptId);

    if (!receipt) {
      throw new Error(`Receipt not found: ${input.receiptId}`);
    }

    if (receipt.status !== 'draft' && receipt.status !== 'processing') {
      throw new Error('Only an unreviewed receipt can be processed by OCR.');
    }

    if (!receipt.imageUri) {
      throw new Error('Receipt does not have a retained source image.');
    }

    if (!receipt.imageWidth || !receipt.imageHeight) {
      throw new Error('Receipt source image dimensions are unavailable.');
    }

    emit('recognizing-text');
    const document = await this.engine.recognize(
      {
        uri: receipt.imageUri,
        width: receipt.imageWidth,
        height: receipt.imageHeight,
      },
      input.signal,
    );

    if (input.signal?.aborted) {
      const error = new Error('OCR processing was cancelled.');
      error.name = 'AbortError';
      throw error;
    }

    emit('redacting-sensitive-data');
    const safeDocument = redactSensitiveOcr(document);

    emit('persisting-evidence');
    const stored = await this.ocr.replaceForReceipt(
      input.receiptId,
      safeDocument,
      input.now ?? new Date().toISOString(),
    );

    emit('complete');
    return stored;
  }
}
