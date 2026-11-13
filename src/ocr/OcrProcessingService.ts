import type { ReceiptRepository } from '../data/repositories/ReceiptRepository';
import type {
  OcrRepository,
  StoredOcrRun,
} from '../data/repositories/OcrRepository';
import { BoundedWorkQueue } from './BoundedWorkQueue';
import { mergeOcrDocuments } from './mergeOcrDocuments';
import { redactSensitiveOcr } from './redactSensitiveOcr';
import type { OcrDocument, OcrEngine } from './types';

export type OcrProgressStage =
  | 'loading-receipt'
  | 'recognizing-text'
  | 'redacting-sensitive-data'
  | 'persisting-evidence'
  | 'complete';

export interface OcrProgressEvent {
  stage: OcrProgressStage;
  elapsedMs: number;
  pageIndex?: number;
  pageCount?: number;
}

export interface ProcessReceiptOcrInput {
  receiptId: string;
  now?: string;
  signal?: AbortSignal;
  onProgress?: (event: OcrProgressEvent) => void;
}

// Prevent simultaneous native OCR work on the same logical receipt, even
// when separate service instances are created by navigation/retry handlers.
const activeReceiptJobs = new Set<string>();
const nativeOcrQueue = new BoundedWorkQueue(1, 2);

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('OCR processing was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

export class OcrProcessingService {
  constructor(
    private readonly engine: OcrEngine,
    private readonly receipts: ReceiptRepository,
    private readonly ocr: OcrRepository,
  ) {}

  async process(input: ProcessReceiptOcrInput): Promise<StoredOcrRun> {
    throwIfCancelled(input.signal);
    if (activeReceiptJobs.has(input.receiptId)) {
      throw new Error('This receipt is already being processed. Please finish or cancel the current scan.');
    }
    activeReceiptJobs.add(input.receiptId);
    try {
      return await this.processExclusive(input);
    } finally {
      activeReceiptJobs.delete(input.receiptId);
    }
  }

  private async processExclusive(input: ProcessReceiptOcrInput): Promise<StoredOcrRun> {
    const startedAt = Date.now();
    const emit = (
      stage: OcrProgressStage,
      pageIndex?: number,
      pageCount?: number,
    ) => {
      input.onProgress?.({
        stage,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        pageIndex,
        pageCount,
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

    const storedPages = await this.receipts.listPages(input.receiptId);
    const pages =
      storedPages.length > 0
        ? storedPages
        : receipt.imageUri && receipt.imageWidth && receipt.imageHeight
          ? [
              {
                id: `legacy-${receipt.id}-0`,
                receiptId: receipt.id,
                position: 0,
                imageUri: receipt.imageUri,
                imageWidth: receipt.imageWidth,
                imageHeight: receipt.imageHeight,
                createdAt: receipt.createdAt,
              },
            ]
          : [];

    if (pages.length === 0) {
      if (receipt.imageUri && (!receipt.imageWidth || !receipt.imageHeight)) {
        throw new Error('Receipt source image dimensions are unavailable.');
      }
      throw new Error('Receipt does not have a retained source image.');
    }
    if (pages.length > 5) {
      throw new Error('A receipt can contain at most 5 photos.');
    }

    throwIfCancelled(input.signal);
    const documents: OcrDocument[] = [];

    for (let index = 0; index < pages.length; index += 1) {
      throwIfCancelled(input.signal);
      const page = pages[index]!;
      emit('recognizing-text', index, pages.length);

      const document = await nativeOcrQueue.run(
        () => this.engine.recognize(
          {
            uri: page.imageUri,
            width: page.imageWidth,
            height: page.imageHeight,
          },
          input.signal,
        ),
        input.signal,
      );

      if (input.signal?.aborted) {
        const error = new Error('OCR processing was cancelled.');
        error.name = 'AbortError';
        throw error;
      }

      emit('redacting-sensitive-data', index, pages.length);
      documents.push(redactSensitiveOcr(document));
    }

    const safeDocument = mergeOcrDocuments(documents);

    throwIfCancelled(input.signal);
    emit('persisting-evidence', pages.length - 1, pages.length);
    const stored = await this.ocr.replaceForReceipt(
      input.receiptId,
      safeDocument,
      input.now ?? new Date().toISOString(),
      { expectedPageUris: pages.map((page) => page.imageUri), signal: input.signal },
    );

    emit('complete');
    return stored;
  }
}
