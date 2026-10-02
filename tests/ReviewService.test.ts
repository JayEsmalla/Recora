import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { OcrRepository } from '../src/data/repositories/OcrRepository';
import { ReceiptRepository } from '../src/data/repositories/ReceiptRepository';
import type { OcrDocument } from '../src/ocr/types';
import { ParserProcessingService } from '../src/parser/ParserProcessingService';
import { ReviewService } from '../src/review/ReviewService';
import {
  createSqlJsConnection,
  type SqlJsConnection,
} from './helpers/SqlJsConnection';

const timestamp = '2026-10-03T00:00:00.000Z';
const now = new Date('2026-10-03T12:00:00Z');

describe('ReviewService', () => {
  let database: SqlJsConnection;
  let receipts: ReceiptRepository;
  let ocr: OcrRepository;
  let service: ReviewService;

  beforeEach(async () => {
    database = await createSqlJsConnection();
    await migrateDatabase(database);
    receipts = new ReceiptRepository(database);
    ocr = new OcrRepository(database);
    service = new ReviewService(
      receipts,
      ocr,
      new ParserProcessingService(ocr),
    );

    await createReceipt('receipt-1');
  });

  afterEach(() => {
    database.close();
  });

  async function createReceipt(id: string) {
    await receipts.createDraft({
      id,
      imageUri: `file:///private/${id}.jpg`,
      imageWidth: 1000,
      imageHeight: 1600,
      now: timestamp,
    });
    await ocr.replaceForReceipt(id, fixtureDocument(), timestamp);
  }

  it('starts review from persisted OCR and immediately makes it restart-safe', async () => {
    const session = await service.load('receipt-1', now);

    expect(session.receipt.status).toBe('review');
    expect(session.draft.items[0]?.id).toBe('receipt-1-item-0');
    expect(session.rawOcrText).toContain('TOTAL 85.00');

    const stored = await receipts.getReviewData('receipt-1');
    expect(stored?.lineItems[0]?.rawName).toBe('MILK');
    expect(stored?.receipt.rawOcrText).toBe(fixtureDocument().rawText);
  });

  it('restores corrected review values instead of reparsing over them', async () => {
    const first = await service.load('receipt-1', now);
    first.draft.merchantName = 'Corrected Store';
    first.draft.items[0]!.rawName = 'Corrected Milk';

    await service.saveDraft('receipt-1', first.draft, now);

    const restarted = new ReviewService(
      receipts,
      ocr,
      new ParserProcessingService(ocr),
    );
    const recovered = await restarted.load('receipt-1', now);

    expect(recovered.draft.merchantName).toBe('Corrected Store');
    expect(recovered.draft.items[0]?.rawName).toBe('Corrected Milk');
    expect(recovered.rawOcrText).toContain('STORE');
  });

  it('does not allow invalid editable text to pollute the saved review', async () => {
    const session = await service.load('receipt-1', now);
    session.draft.totalText = 'not money';

    await expect(
      service.saveDraft('receipt-1', session.draft, now),
    ).rejects.toThrow('Correct invalid review fields');

    const stored = await receipts.getReviewData('receipt-1');
    expect(stored?.receipt.totalMinor).toBe(8500);
  });

  it('blocks final acceptance while a mismatch remains', async () => {
    const session = await service.load('receipt-1', now);
    session.draft.totalText = '99.00';
    await service.saveDraft('receipt-1', session.draft, now);

    await expect(
      service.saveAccepted('receipt-1', session.draft, true, now),
    ).rejects.toThrow('Resolve receipt mismatches');

    expect((await receipts.getById('receipt-1'))?.status).toBe('review');
  });

  it('requires explicit acknowledgement for non-blocking review warnings', async () => {
    const session = await service.load('receipt-1', now);
    session.draft.items.push({
      ...session.draft.items[0]!,
      id: 'receipt-1-duplicate',
    });
    session.draft.subtotalText = '170.00';
    session.draft.totalText = '170.00';

    const saved = await service.saveDraft('receipt-1', session.draft, now);
    expect(saved.evaluation.validation.state).toBe('review');

    await expect(
      service.saveAccepted('receipt-1', saved.draft, false, now),
    ).rejects.toThrow('Acknowledge');

    await service.saveAccepted('receipt-1', saved.draft, true, now);
    expect((await receipts.getById('receipt-1'))?.status).toBe('accepted');
  });

  it('accepts verified corrected values without altering raw OCR evidence', async () => {
    const session = await service.load('receipt-1', now);
    session.draft.merchantName = 'Final Store';
    await service.saveDraft('receipt-1', session.draft, now);

    await service.saveAccepted('receipt-1', session.draft, false, now);

    const stored = await receipts.getReviewData('receipt-1');
    expect(stored?.receipt.status).toBe('accepted');
    expect(stored?.receipt.merchantRawName).toBe('Final Store');
    expect(stored?.receipt.rawOcrText).toBe(fixtureDocument().rawText);
  });

  it('returns the private image URI when discarding an unfinished receipt', async () => {
    await service.load('receipt-1', now);

    expect(await service.discard('receipt-1')).toBe(
      'file:///private/receipt-1.jpg',
    );
    expect(await receipts.getById('receipt-1')).toBeNull();
    expect(await ocr.getForReceipt('receipt-1')).toBeNull();
  });

  it('uses receipt-scoped item ids so separate reviews cannot collide', async () => {
    await createReceipt('receipt-2');

    const first = await service.load('receipt-1', now);
    const second = await service.load('receipt-2', now);

    expect(first.draft.items[0]?.id).not.toBe(second.draft.items[0]?.id);
    expect((await receipts.getReviewData('receipt-1'))?.lineItems).toHaveLength(
      1,
    );
    expect((await receipts.getReviewData('receipt-2'))?.lineItems).toHaveLength(
      1,
    );
  });
});

function fixtureDocument(): OcrDocument {
  const texts = [
    'STORE',
    '2026-10-03',
    'MILK 85.00',
    'SUBTOTAL 85.00',
    'TOTAL 85.00',
  ];

  return {
    engine: 'fixture',
    imageWidth: 1000,
    imageHeight: 1600,
    rawText: texts.join('\n'),
    blocks: [
      {
        id: 'block',
        text: texts.join('\n'),
        frame: { x: 20, y: 20, width: 900, height: 500 },
        confidence: null,
        lines: texts.map((text, index) => ({
          id: `line-${index}`,
          text,
          frame: { x: 40, y: 40 + index * 70, width: 850, height: 42 },
          confidence: null,
          elements: [],
        })),
      },
    ],
  };
}
