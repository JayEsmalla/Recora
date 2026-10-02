import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { OcrRepository } from '../src/data/repositories/OcrRepository';
import { ReceiptRepository } from '../src/data/repositories/ReceiptRepository';
import type { OcrDocument } from '../src/ocr/types';
import {
  ParserProcessingService,
  rebuildDocument,
} from '../src/parser/ParserProcessingService';
import {
  createSqlJsConnection,
  type SqlJsConnection,
} from './helpers/SqlJsConnection';

const now = '2026-10-03T00:00:00.000Z';

const document: OcrDocument = {
  engine: 'fixture',
  imageWidth: 1000,
  imageHeight: 1600,
  rawText: 'STORE\n2026-10-13\nMILK 85.00\nTOTAL 85.00',
  blocks: [
    {
      id: 'b0',
      text: 'STORE\n2026-10-13\nMILK 85.00\nTOTAL 85.00',
      frame: { x: 20, y: 20, width: 900, height: 400 },
      confidence: null,
      lines: [
        makeLine('b0-l0', 'STORE', 40),
        makeLine('b0-l1', '2026-10-13', 110),
        makeLine('b0-l2', 'MILK 85.00', 180),
        makeLine('b0-l3', 'TOTAL 85.00', 250),
      ],
    },
  ],
};

describe('ParserProcessingService', () => {
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

  it('rebuilds parser input from persisted OCR evidence after a restart boundary', async () => {
    await ocr.replaceForReceipt('receipt-1', document, now);

    const stored = await ocr.getForReceipt('receipt-1');
    expect(stored).not.toBeNull();

    const rebuilt = rebuildDocument(stored!);
    expect(rebuilt.blocks[0]?.lines.map((line) => line.text)).toEqual([
      'STORE',
      '2026-10-13',
      'MILK 85.00',
      'TOTAL 85.00',
    ]);
  });

  it('parses persisted OCR without relying on transient native OCR state', async () => {
    await ocr.replaceForReceipt('receipt-1', document, now);

    const service = new ParserProcessingService(ocr);
    const candidate = await service.parseReceipt('receipt-1');

    expect(candidate.merchant?.rawName).toBe('STORE');
    expect(candidate.items[0]).toEqual(
      expect.objectContaining({
        rawName: 'MILK',
        lineTotalMinor: 8500,
      }),
    );
    expect(candidate.summary.totalMinor).toBe(8500);
  });

  it('requires completed OCR evidence', async () => {
    const service = new ParserProcessingService(ocr);

    await expect(service.parseReceipt('receipt-1')).rejects.toThrow(
      'completed OCR evidence',
    );
  });
});

function makeLine(id: string, text: string, y: number) {
  return {
    id,
    text,
    frame: { x: 40, y, width: 850, height: 42 },
    confidence: null,
    elements: [],
  };
}
