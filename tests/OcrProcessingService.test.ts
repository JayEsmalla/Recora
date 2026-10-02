import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { OcrRepository } from '../src/data/repositories/OcrRepository';
import { ReceiptRepository } from '../src/data/repositories/ReceiptRepository';
import { FakeOcrEngine } from '../src/ocr/FakeOcrEngine';
import { OcrProcessingService } from '../src/ocr/OcrProcessingService';
import type { OcrDocument, OcrEngine } from '../src/ocr/types';
import {
  createSqlJsConnection,
  type SqlJsConnection,
} from './helpers/SqlJsConnection';

const imageUri = 'file:///private/receipt-1.jpg';
const now = '2026-10-03T00:00:00.000Z';

const fixture: OcrDocument = {
  engine: 'fixture',
  imageWidth: 1000,
  imageHeight: 2000,
  rawText: 'STORE\nTOTAL 85.00',
  blocks: [],
};

describe('OcrProcessingService', () => {
  let database: SqlJsConnection;
  let receipts: ReceiptRepository;
  let ocr: OcrRepository;

  beforeEach(async () => {
    database = await createSqlJsConnection();
    await migrateDatabase(database);
    receipts = new ReceiptRepository(database);
    ocr = new OcrRepository(database);
    await receipts.createDraft({
      id: 'receipt-1',
      imageUri,
      imageWidth: 1000,
      imageHeight: 2000,
      now,
    });
  });

  afterEach(() => {
    database.close();
  });

  it('runs a fixture engine and persists only completed results', async () => {
    const service = new OcrProcessingService(
      new FakeOcrEngine(fixture),
      receipts,
      ocr,
    );

    const run = await service.process({
      receiptId: 'receipt-1',
      now,
    });

    expect(run.rawText).toBe('STORE\nTOTAL 85.00');
    expect((await receipts.getById('receipt-1'))?.status).toBe('draft');
  });

  it('reports deterministic OCR progress stages for profiling and UI feedback', async () => {
    const service = new OcrProcessingService(
      new FakeOcrEngine(fixture),
      receipts,
      ocr,
    );
    const events: Array<{ stage: string; elapsedMs: number }> = [];

    await service.process({
      receiptId: 'receipt-1',
      now,
      onProgress(event) {
        events.push(event);
      },
    });

    expect(events.map((event) => event.stage)).toEqual([
      'loading-receipt',
      'recognizing-text',
      'redacting-sensitive-data',
      'persisting-evidence',
      'complete',
    ]);
    expect(events.every((event) => event.elapsedMs >= 0)).toBe(true);
    expect(
      events.every(
        (event, index) =>
          index === 0 || event.elapsedMs >= events[index - 1]!.elapsedMs,
      ),
    ).toBe(true);
  });

  it('does not persist a cancelled OCR result', async () => {
    const controller = new AbortController();
    controller.abort();

    const service = new OcrProcessingService(
      new FakeOcrEngine(fixture),
      receipts,
      ocr,
    );

    await expect(
      service.process({
        receiptId: 'receipt-1',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(await ocr.getForReceipt('receipt-1')).toBeNull();
  });

  it('does not alter saved receipt history when the engine fails', async () => {
    const failingEngine: OcrEngine = {
      id: 'failure',
      async recognize() {
        throw new Error('native OCR failed');
      },
    };

    const service = new OcrProcessingService(failingEngine, receipts, ocr);

    await expect(
      service.process({
        receiptId: 'receipt-1',
      }),
    ).rejects.toThrow('native OCR failed');

    expect((await receipts.getById('receipt-1'))?.rawOcrText).toBeNull();
    expect(await ocr.getForReceipt('receipt-1')).toBeNull();
  });

  it('requires retained image dimensions before invoking OCR', async () => {
    await receipts.createDraft({
      id: 'receipt-no-size',
      imageUri: 'file:///private/no-size.jpg',
      now,
    });

    const service = new OcrProcessingService(
      new FakeOcrEngine(fixture),
      receipts,
      ocr,
    );

    await expect(
      service.process({
        receiptId: 'receipt-no-size',
      }),
    ).rejects.toThrow('dimensions are unavailable');

    expect(await ocr.getForReceipt('receipt-no-size')).toBeNull();
  });
});
