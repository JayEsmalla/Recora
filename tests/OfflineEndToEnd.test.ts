import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { OcrRepository } from '../src/data/repositories/OcrRepository';
import { ReceiptRepository } from '../src/data/repositories/ReceiptRepository';
import { HistoryRepository } from '../src/history/HistoryRepository';
import { HistoryService } from '../src/history/HistoryService';
import { NormalizationService } from '../src/history/NormalizationService';
import { FakeOcrEngine } from '../src/ocr/FakeOcrEngine';
import { OcrProcessingService } from '../src/ocr/OcrProcessingService';
import { ParserProcessingService } from '../src/parser/ParserProcessingService';
import { ReviewService } from '../src/review/ReviewService';
import {
  createSqlJsConnection,
  type SqlJsConnection,
} from './helpers/SqlJsConnection';
import { makeCorpusDocument } from './fixtures/receiptParserCorpus';

const nowIso = '2026-10-03T12:00:00.000Z';
const now = new Date(nowIso);
const originalFetch = globalThis.fetch;

describe('offline end-to-end receipt workflow', () => {
  let database: SqlJsConnection;
  let receipts: ReceiptRepository;
  let ocr: OcrRepository;

  beforeEach(async () => {
    database = await createSqlJsConnection();
    await migrateDatabase(database);
    receipts = new ReceiptRepository(database);
    ocr = new OcrRepository(database);

    globalThis.fetch = (async () => {
      throw new Error('Network access is forbidden in the offline acceptance test.');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    database.close();
  });

  it('completes OCR, restart-safe review, acceptance, search, reopen, and deletion without network access', async () => {
    const receiptId = 'offline-e2e';
    const document = makeCorpusDocument([
      'ALPHA MART',
      '2026-10-01',
      'MILK 85.00',
      'BREAD 40.00',
      'SUBTOTAL 125.00',
      'TOTAL 125.00',
    ]);

    await receipts.createDraft({
      id: receiptId,
      imageUri: 'file:///private/offline-e2e.jpg',
      imageWidth: document.imageWidth,
      imageHeight: document.imageHeight,
      now: nowIso,
    });

    const ocrService = new OcrProcessingService(
      new FakeOcrEngine(document),
      receipts,
      ocr,
    );

    const persistedOcr = await ocrService.process({
      receiptId,
      now: nowIso,
    });

    expect(persistedOcr.rawText).toContain('TOTAL 125.00');
    expect((await receipts.getById(receiptId))?.status).toBe('draft');

    const firstReviewService = createReviewService();
    const firstSession = await firstReviewService.load(receiptId, now);

    expect(firstSession.evaluation.validation.state).toBe('verified');
    expect((await receipts.getById(receiptId))?.status).toBe('review');

    firstSession.draft.merchantName = 'Alpha Mart';
    const savedSession = await firstReviewService.saveDraft(
      receiptId,
      firstSession.draft,
      now,
    );
    expect(savedSession.draft.merchantName).toBe('Alpha Mart');

    // Recreate every application service to model a process restart boundary.
    const restartedReviewService = createReviewService();
    const recoveredSession = await restartedReviewService.load(receiptId, now);
    expect(recoveredSession.draft.merchantName).toBe('Alpha Mart');
    expect(recoveredSession.rawOcrText).toBe(document.rawText);

    await restartedReviewService.saveAccepted(
      receiptId,
      recoveredSession.draft,
      false,
      now,
    );

    expect((await receipts.getById(receiptId))?.status).toBe('accepted');

    const historyRepository = new HistoryRepository(database);
    const historyService = new HistoryService(
      historyRepository,
      new NormalizationService(historyRepository),
    );

    const overview = await historyService.loadOverview({ query: 'bread' });
    expect(overview.receipts.map((entry) => entry.receiptId)).toEqual([
      receiptId,
    ]);
    expect(overview.items.map((item) => item.rawName)).toContain('BREAD');

    const detail = await historyService.getReceiptDetail(receiptId);
    expect(detail?.merchantName).toBe('Alpha Mart');
    expect(detail?.rawOcrText).toBe(document.rawText);
    expect(detail?.items.map((item) => item.rawName)).toEqual([
      'MILK',
      'BREAD',
    ]);

    const rawEvidenceAfterAcceptance = await ocr.getForReceipt(receiptId);
    expect(rawEvidenceAfterAcceptance?.rawText).toBe(document.rawText);

    expect(await historyService.deleteReceipt(receiptId)).toBe(
      'file:///private/offline-e2e.jpg',
    );
    expect(await historyService.getReceiptDetail(receiptId)).toBeNull();
    expect((await historyService.loadOverview()).receipts).toEqual([]);
    expect(await ocr.getForReceipt(receiptId)).toBeNull();
  });

  it('does not expose a saved review draft as purchase history after an interruption', async () => {
    const receiptId = 'interrupted-review';
    const document = makeCorpusDocument([
      'STORE',
      '2026-10-01',
      'SOAP 50.00',
      'TOTAL 50.00',
    ]);

    await receipts.createDraft({
      id: receiptId,
      imageUri: 'file:///private/interrupted-review.jpg',
      imageWidth: document.imageWidth,
      imageHeight: document.imageHeight,
      now: nowIso,
    });

    await new OcrProcessingService(
      new FakeOcrEngine(document),
      receipts,
      ocr,
    ).process({
      receiptId,
      now: nowIso,
    });

    const review = createReviewService();
    const session = await review.load(receiptId, now);
    await review.saveDraft(receiptId, session.draft, now);

    const historyRepository = new HistoryRepository(database);
    const historyService = new HistoryService(
      historyRepository,
      new NormalizationService(historyRepository),
    );

    expect((await receipts.getById(receiptId))?.status).toBe('review');
    expect((await historyService.loadOverview()).receipts).toEqual([]);

    const restarted = createReviewService();
    const recovered = await restarted.load(receiptId, now);
    expect(recovered.draft.items[0]?.rawName).toBe('SOAP');
  });

  function createReviewService(): ReviewService {
    return new ReviewService(
      receipts,
      ocr,
      new ParserProcessingService(ocr),
    );
  }
});
