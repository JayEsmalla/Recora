import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { OcrRepository } from '../src/data/repositories/OcrRepository';
import { ReceiptRepository } from '../src/data/repositories/ReceiptRepository';
import type { OcrDocument } from '../src/ocr/types';
import {
  createSqlJsConnection,
  type SqlJsConnection,
} from './helpers/SqlJsConnection';

const now = '2026-10-03T00:00:00.000Z';

const document: OcrDocument = {
  engine: 'fixture',
  imageWidth: 1000,
  imageHeight: 2000,
  rawText: 'STORE\nMILK 85.00',
  blocks: [
    {
      id: 'b0',
      text: 'STORE\nMILK 85.00',
      frame: { x: 20, y: 30, width: 900, height: 300 },
      confidence: null,
      lines: [
        {
          id: 'b0-l0',
          text: 'STORE',
          frame: { x: 50, y: 40, width: 300, height: 50 },
          confidence: null,
          elements: [
            {
              id: 'b0-l0-e0',
              text: 'STORE',
              frame: { x: 50, y: 40, width: 300, height: 50 },
              confidence: null,
            },
          ],
        },
        {
          id: 'b0-l1',
          text: 'MILK 85.00',
          frame: { x: 50, y: 140, width: 700, height: 50 },
          confidence: null,
          elements: [
            {
              id: 'b0-l1-e0',
              text: 'MILK',
              frame: { x: 50, y: 140, width: 250, height: 50 },
              confidence: null,
            },
            {
              id: 'b0-l1-e1',
              text: '85.00',
              frame: { x: 600, y: 140, width: 150, height: 50 },
              confidence: null,
            },
          ],
        },
      ],
    },
  ],
};

describe('OcrRepository', () => {
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
      imageUri: 'file:///private/receipt-1.jpg',
      now,
    });
  });

  afterEach(() => {
    database.close();
  });

  it('persists raw OCR and spatial observations transactionally', async () => {
    const stored = await ocr.replaceForReceipt('receipt-1', document, now);

    expect(stored.observations).toHaveLength(6);
    expect((await receipts.getById('receipt-1'))?.rawOcrText).toBe(
      'STORE\nMILK 85.00',
    );
    expect((await receipts.listUnfinished())[0]).toEqual(
      expect.objectContaining({
        id: 'receipt-1',
        hasOcrText: true,
      }),
    );

    const reloaded = await ocr.getForReceipt('receipt-1');
    expect(reloaded?.engine).toBe('fixture');
    expect(reloaded?.observations.find((item) => item.id === 'b0-l1-e1')).toEqual(
      expect.objectContaining({
        parentId: 'b0-l1',
        kind: 'element',
        text: '85.00',
      }),
    );
  });

  it('replaces a previous OCR run without duplicating observations', async () => {
    await ocr.replaceForReceipt('receipt-1', document, now);
    await ocr.replaceForReceipt(
      'receipt-1',
      {
        ...document,
        rawText: 'TOTAL 85.00',
        blocks: [],
      },
      '2026-10-03T00:01:00.000Z',
    );

    const reloaded = await ocr.getForReceipt('receipt-1');
    expect(reloaded?.rawText).toBe('TOTAL 85.00');
    expect(reloaded?.observations).toHaveLength(0);

    const count = await database.first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM ocr_runs WHERE receipt_id = ?;',
      ['receipt-1'],
    );
    expect(count?.count).toBe(1);
  });

  it('keeps identical logical observation ids isolated across receipts', async () => {
    await receipts.createDraft({
      id: 'receipt-2',
      imageUri: 'file:///private/receipt-2.jpg',
      now,
    });

    await ocr.replaceForReceipt('receipt-1', document, now);
    await ocr.replaceForReceipt('receipt-2', document, now);

    const first = await ocr.getForReceipt('receipt-1');
    const second = await ocr.getForReceipt('receipt-2');

    expect(first?.observations.find((item) => item.id === 'b0-l1-e1')?.text).toBe(
      '85.00',
    );
    expect(second?.observations.find((item) => item.id === 'b0-l1-e1')?.text).toBe(
      '85.00',
    );

    const storedIds = await database.all<{ id: string }>(
      `SELECT id FROM ocr_observations
       WHERE id LIKE ?
       ORDER BY id ASC;`,
      ['%::b0-l1-e1'],
    );

    expect(storedIds).toHaveLength(2);
    expect(storedIds[0]?.id).not.toBe(storedIds[1]?.id);
  });

  it('persists large OCR evidence across multiple batched insert chunks', async () => {
    const largeDocument: OcrDocument = {
      engine: 'fixture',
      imageWidth: 1200,
      imageHeight: 12000,
      rawText: Array.from({ length: 120 }, (_, index) => `ITEM ${index} 1.00`).join('\n'),
      blocks: [
        {
          id: 'large-block',
          text: 'large receipt',
          frame: { x: 0, y: 0, width: 1200, height: 12000 },
          confidence: null,
          lines: Array.from({ length: 120 }, (_, index) => ({
            id: `large-line-${index}`,
            text: `ITEM ${index} 1.00`,
            frame: { x: 20, y: index * 80, width: 1100, height: 50 },
            confidence: null,
            elements: [
              {
                id: `large-line-${index}-name`,
                text: `ITEM ${index}`,
                frame: { x: 20, y: index * 80, width: 700, height: 50 },
                confidence: null,
              },
              {
                id: `large-line-${index}-amount`,
                text: '1.00',
                frame: { x: 900, y: index * 80, width: 180, height: 50 },
                confidence: null,
              },
            ],
          })),
        },
      ],
    };

    const stored = await ocr.replaceForReceipt(
      'receipt-1',
      largeDocument,
      now,
    );
    const reloaded = await ocr.getForReceipt('receipt-1');

    expect(stored.observations).toHaveLength(361);
    expect(reloaded?.observations).toHaveLength(361);
    expect(
      reloaded?.observations.find(
        (item) => item.id === 'large-line-119-amount',
      )?.text,
    ).toBe('1.00');
  });

  it('cascades OCR evidence when its receipt is deleted', async () => {
    await ocr.replaceForReceipt('receipt-1', document, now);

    await receipts.deleteReceipt('receipt-1');

    const runCount = await database.first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM ocr_runs;',
    );
    const observationCount = await database.first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM ocr_observations;',
    );

    expect(runCount?.count).toBe(0);
    expect(observationCount?.count).toBe(0);
  });

  it('does not allow OCR evidence to rewrite accepted history', async () => {
    await receipts.replaceReviewData({
      receiptId: 'receipt-1',
      validationState: 'verified',
      lineItems: [],
      adjustments: [],
      now,
    });
    await receipts.acceptReceipt('receipt-1', now);

    await expect(
      ocr.replaceForReceipt('receipt-1', document, now),
    ).rejects.toThrow('unreviewed receipt');
  });
});
