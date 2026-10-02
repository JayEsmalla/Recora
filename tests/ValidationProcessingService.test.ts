import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { OcrRepository } from '../src/data/repositories/OcrRepository';
import { ReceiptRepository } from '../src/data/repositories/ReceiptRepository';
import type { OcrDocument } from '../src/ocr/types';
import { ParserProcessingService } from '../src/parser/ParserProcessingService';
import { ValidationProcessingService } from '../src/validation/ValidationProcessingService';
import {
  createSqlJsConnection,
  type SqlJsConnection,
} from './helpers/SqlJsConnection';

const now = '2026-10-03T00:00:00.000Z';

describe('ValidationProcessingService', () => {
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
      imageUri: 'file:///receipt.jpg',
      imageWidth: 1000,
      imageHeight: 1600,
      now,
    });
  });

  afterEach(() => {
    database.close();
  });

  it('runs parser and validation from persisted OCR evidence', async () => {
    await ocr.replaceForReceipt('receipt-1', fixtureDocument(), now);

    const service = new ValidationProcessingService(
      new ParserProcessingService(ocr),
      ocr,
    );
    const analysis = await service.analyze(
      'receipt-1',
      new Date('2026-10-03T12:00:00Z'),
    );

    expect(analysis.candidate.items[0]?.rawName).toBe('MILK');
    expect(analysis.validation.state).toBe('verified');
    expect(analysis.validation.counters.totalChecks).toBe(1);
  });

  it('does not invent OCR confidence when persisted observations have no confidence', async () => {
    await ocr.replaceForReceipt('receipt-1', fixtureDocument(), now);

    const service = new ValidationProcessingService(
      new ParserProcessingService(ocr),
      ocr,
    );
    const analysis = await service.analyze(
      'receipt-1',
      new Date('2026-10-03T12:00:00Z'),
    );

    expect(
      analysis.validation.confidence.every(
        (field) => field.ocrConfidenceBasisPoints === null,
      ),
    ).toBe(true);
  });
});

function fixtureDocument(): OcrDocument {
  const lines = [
    ['merchant', 'STORE'],
    ['date', '2026-10-03'],
    ['item', 'MILK 85.00'],
    ['subtotal', 'SUBTOTAL 85.00'],
    ['total', 'TOTAL 85.00'],
  ] as const;

  return {
    engine: 'fixture',
    imageWidth: 1000,
    imageHeight: 1600,
    rawText: lines.map(([, text]) => text).join('\n'),
    blocks: [
      {
        id: 'block',
        text: lines.map(([, text]) => text).join('\n'),
        frame: { x: 20, y: 20, width: 900, height: 500 },
        confidence: null,
        lines: lines.map(([id, text], index) => ({
          id,
          text,
          frame: { x: 40, y: 40 + index * 70, width: 850, height: 42 },
          confidence: null,
          elements: [],
        })),
      },
    ],
  };
}
