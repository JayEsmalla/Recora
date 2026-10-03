import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { ReceiptRepository } from '../src/data/repositories/ReceiptRepository';
import { HistoryRepository } from '../src/history/HistoryRepository';
import { HistoryService } from '../src/history/HistoryService';
import { NormalizationService } from '../src/history/NormalizationService';
import {
  createSqlJsConnection,
  type SqlJsConnection,
} from './helpers/SqlJsConnection';

const now = '2026-10-03T00:00:00.000Z';

describe('HistoryRepository', () => {
  let database: SqlJsConnection;
  let receipts: ReceiptRepository;
  let history: HistoryRepository;

  beforeEach(async () => {
    database = await createSqlJsConnection();
    await migrateDatabase(database);
    receipts = new ReceiptRepository(database);
    history = new HistoryRepository(database);

    await createAcceptedReceipt({
      id: 'receipt-old',
      merchant: 'Alpha Market',
      purchasedAt: '2026-09-01',
      totalMinor: 13500,
      items: [
        {
          id: 'old-milk',
          rawName: 'MILK 1L',
          unitPriceMinor: 8500,
          lineTotalMinor: 8500,
        },
        {
          id: 'old-soap',
          rawName: 'SOAP BAR',
          unitPriceMinor: 5000,
          lineTotalMinor: 5000,
        },
      ],
    });

    await createAcceptedReceipt({
      id: 'receipt-new',
      merchant: 'Beta Store',
      purchasedAt: '2026-10-01T18:30:00',
      totalMinor: 9000,
      items: [
        {
          id: 'new-milk',
          rawName: 'FRESH MILK 1L',
          unitPriceMinor: 9000,
          lineTotalMinor: 9000,
        },
      ],
    });

    await receipts.createDraft({
      id: 'unfinished',
      merchantRawName: 'Hidden Draft',
      now,
    });
  });

  afterEach(() => {
    database.close();
  });

  it('loads only the active history mode when requested', async () => {
    const service = new HistoryService(
      history,
      new NormalizationService(history),
    );

    const receiptsOnly = await service.loadOverview({}, 'receipts', false);
    expect(receiptsOnly.receipts).toHaveLength(2);
    expect(receiptsOnly.items).toEqual([]);
    expect(receiptsOnly.categories).toEqual([]);

    const itemsOnly = await service.loadOverview({}, 'items', false);
    expect(itemsOnly.receipts).toEqual([]);
    expect(itemsOnly.items).toHaveLength(3);
    expect(itemsOnly.categories).toEqual([]);
  });

  it('lists accepted receipts newest first and excludes unfinished drafts', async () => {
    const entries = await history.listReceipts();

    expect(entries.map((entry) => entry.receiptId)).toEqual([
      'receipt-new',
      'receipt-old',
    ]);
    expect(entries[0]?.itemCount).toBe(1);
    expect(entries.some((entry) => entry.receiptId === 'unfinished')).toBe(false);
  });

  it('searches history by merchant and raw item text', async () => {
    const merchantMatches = await history.listReceipts({
      merchantQuery: 'alpha',
    });
    expect(merchantMatches.map((entry) => entry.receiptId)).toEqual([
      'receipt-old',
    ]);

    const itemMatches = await history.searchItems({ query: 'milk' });
    expect(itemMatches.map((entry) => entry.lineItemId)).toEqual([
      'new-milk',
      'old-milk',
    ]);
  });

  it('supports accepted receipt detail with source evidence', async () => {
    const detail = await history.getReceiptDetail('receipt-old');

    expect(detail).toEqual(
      expect.objectContaining({
        receiptId: 'receipt-old',
        merchantName: 'Alpha Market',
        imageUri: 'file:///receipt-old.jpg',
        imageUris: ['file:///receipt-old.jpg'],
        rawOcrText: 'RAW receipt-old',
      }),
    );
    expect(detail?.items.map((item) => item.rawName)).toEqual([
      'MILK 1L',
      'SOAP BAR',
    ]);
  });

  it('filters accepted receipts and items by date range', async () => {
    const receiptsInOctober = await history.listReceipts({
      fromDate: '2026-10-01',
      toDate: '2026-10-01',
    });
    expect(receiptsInOctober.map((entry) => entry.receiptId)).toEqual([
      'receipt-new',
    ]);

    const itemsInSeptember = await history.searchItems({
      fromDate: '2026-09-01',
      toDate: '2026-09-30T23:59:59',
    });
    expect(itemsInSeptember).toHaveLength(2);
    expect(itemsInSeptember.every((item) => item.receiptId === 'receipt-old')).toBe(
      true,
    );
  });

  it('raw-name item history works until an item is normalized', async () => {
    const summary = await history.getItemHistory({ rawName: 'MILK 1L' });

    expect(summary?.purchaseCount).toBe(1);
    expect(summary?.latestUnitPriceMinor).toBe(8500);
    expect(summary?.points[0]?.receiptId).toBe('receipt-old');
  });

  it('deleting an accepted receipt removes its contribution from search and history', async () => {
    expect(await history.deleteAcceptedReceipt('receipt-new')).toEqual([
      'file:///receipt-new.jpg',
    ]);

    expect(await history.getReceiptDetail('receipt-new')).toBeNull();
    expect(
      (await history.searchItems({ query: 'FRESH MILK' })).map(
        (entry) => entry.lineItemId,
      ),
    ).toEqual([]);
  });

  async function createAcceptedReceipt(input: {
    id: string;
    merchant: string;
    purchasedAt: string;
    totalMinor: number;
    items: {
      id: string;
      rawName: string;
      unitPriceMinor: number;
      lineTotalMinor: number;
    }[];
  }) {
    await receipts.createDraft({
      id: input.id,
      merchantRawName: input.merchant,
      purchasedAt: input.purchasedAt,
      imageUri: 'file:///' + input.id + '.jpg',
      rawOcrText: 'RAW ' + input.id,
      now,
    });

    await receipts.saveAcceptedReview({
      receiptId: input.id,
      merchantRawName: input.merchant,
      purchasedAt: input.purchasedAt,
      totalMinor: input.totalMinor,
      validationState: 'verified',
      lineItems: input.items.map((item, position) => ({
        id: item.id,
        position,
        rawName: item.rawName,
        quantityMilli: 1000,
        unitPriceMinor: item.unitPriceMinor,
        lineTotalMinor: item.lineTotalMinor,
        reviewState: 'verified',
      })),
      adjustments: [],
      now,
    });
  }
});
