import type { ReceiptRepository } from '../data/repositories/ReceiptRepository';
import type {
  OcrRepository,
  StoredOcrRun,
} from '../data/repositories/OcrRepository';
import { redactSensitiveOcr } from './redactSensitiveOcr';
import type { OcrEngine } from './types';

export interface ProcessReceiptOcrInput {
  receiptId: string;
  now?: string;
  signal?: AbortSignal;
}

export class OcrProcessingService {
  constructor(
    private readonly engine: OcrEngine,
    private readonly receipts: ReceiptRepository,
    private readonly ocr: OcrRepository,
  ) {}

  async process(input: ProcessReceiptOcrInput): Promise<StoredOcrRun> {
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

    return this.ocr.replaceForReceipt(
      input.receiptId,
      redactSensitiveOcr(document),
      input.now ?? new Date().toISOString(),
    );
  }
}
