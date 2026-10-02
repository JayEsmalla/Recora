import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { ReceiptRepository } from '../src/data/repositories/ReceiptRepository';
import { HistoryRepository } from '../src/history/HistoryRepository';
import { NormalizationService } from '../src/history/NormalizationService';
import {
  createSqlJsConnection,
  type SqlJsConnection,
} from './helpers/SqlJsConnection';

const now = '2026-10-03T00:00:00.000Z';

describe('NormalizationService', () => {
  let database: SqlJsConnection;
  let receipts: ReceiptRepository;
  let history: HistoryRepository;
  let normalization: NormalizationService;
  let sequence = 0;

  beforeEach(async () => {
    database = await createSqlJsConnection();
    await migrateDatabase(database);
    receipts = new ReceiptRepository(database);
    history = new HistoryRepository(database);
    sequence = 0;
    normalization = new NormalizationService(
      history,
      (prefix) => prefix + '-test-' + ++sequence,
    );

    await createAcceptedReceipt('receipt-1', 'Shop A', 'MILK 1L', 'line-1');
  });

  afterEach(() => {
    database.close();
  });

  it('assigns a canonical identity without overwriting the raw receipt description', async () => {
    const normalized = await normalization.assignIdentity({
      lineItemId: 'line-1',
      canonicalName: 'Fresh Milk 1 Liter',
      categoryId: 'category-food-groceries',
      now,
    });

    const detail = await history.getReceiptDetail('receipt-1');
    expect(normalized.canonicalName).toBe('Fresh Milk 1 Liter');
    expect(detail?.items[0]).toEqual(
      expect.objectContaining({
        rawName: 'MILK 1L',
        normalizedName: 'Fresh Milk 1 Liter',
        categoryName: 'Food & Groceries',
      }),
    );
  });

  it('groups different raw descriptions into one normalized price history', async () => {
    const normalized = await normalization.assignIdentity({
      lineItemId: 'line-1',
      canonicalName: 'Fresh Milk 1 Liter',
      categoryId: 'category-food-groceries',
      now,
    });

    await createAcceptedReceipt(
      'receipt-2',
      'Shop B',
      'FRESH MILK 1000ML',
      'line-2',
      9200,
      '2026-10-02',
    );

    await normalization.assignIdentity({
      lineItemId: 'line-2',
      canonicalName: 'Fresh Milk 1 Liter',
      now,
    });

    const itemHistory = await history.getItemHistory({
      normalizedItemId: normalized.id,
    });

    expect(itemHistory?.purchaseCount).toBe(2);
    expect(itemHistory?.points.map((point) => point.rawName)).toEqual([
      'FRESH MILK 1000ML',
      'MILK 1L',
    ]);
    expect(itemHistory?.latestUnitPriceMinor).toBe(9200);
  });

  it('learns only an exact merchant-specific rule when explicitly requested', async () => {
    const normalized = await normalization.assignIdentity({
      lineItemId: 'line-1',
      canonicalName: 'Fresh Milk 1 Liter',
      categoryId: 'category-food-groceries',
      rememberForMerchant: true,
      now,
    });

    const context = await history.getAcceptedLineItemContext('line-1');
    expect(context?.merchantId).not.toBeNull();

    const rules = await history.listCorrectionRules(context!.merchantId!);
    expect(rules).toEqual([
      expect.objectContaining({
        pattern: 'MILK 1L',
        correction: 'Fresh Milk 1 Liter',
        normalizedItemId: normalized.id,
      }),
    ]);
  });

  it('applies a learned rule only to the same merchant and exact raw name', async () => {
    await normalization.assignIdentity({
      lineItemId: 'line-1',
      canonicalName: 'Fresh Milk 1 Liter',
      rememberForMerchant: true,
      now,
    });

    await createAcceptedReceipt(
      'receipt-2',
      'Shop A',
      'MILK 1L',
      'line-2',
      9000,
      '2026-10-02',
    );
    await createAcceptedReceipt(
      'receipt-3',
      'Shop A',
      'MILK 1 LITER',
      'line-3',
      9100,
      '2026-10-03',
    );
    await createAcceptedReceipt(
      'receipt-4',
      'Shop B',
      'MILK 1L',
      'line-4',
      9200,
      '2026-10-03',
    );

    expect(await normalization.applyKnownRules('receipt-2', now)).toBe(1);
    expect(await normalization.applyKnownRules('receipt-3', now)).toBe(0);
    expect(await normalization.applyKnownRules('receipt-4', now)).toBe(0);

    expect(
      (await history.getAcceptedLineItemContext('line-2'))?.normalizedItemId,
    ).not.toBeNull();
    expect(
      (await history.getAcceptedLineItemContext('line-3'))?.normalizedItemId,
    ).toBeNull();
    expect(
      (await history.getAcceptedLineItemContext('line-4'))?.normalizedItemId,
    ).toBeNull();
  });

  it('can unlink an item without changing its raw description', async () => {
    await normalization.assignIdentity({
      lineItemId: 'line-1',
      canonicalName: 'Fresh Milk 1 Liter',
      now,
    });
    await normalization.unlinkIdentity('line-1', now);

    const detail = await history.getReceiptDetail('receipt-1');
    expect(detail?.items[0]?.normalizedItemId).toBeNull();
    expect(detail?.items[0]?.rawName).toBe('MILK 1L');
  });

  it('can reset learned rules for the merchant', async () => {
    await normalization.assignIdentity({
      lineItemId: 'line-1',
      canonicalName: 'Fresh Milk 1 Liter',
      rememberForMerchant: true,
      now,
    });

    expect(await normalization.resetRulesForReceipt('receipt-1', now)).toBe(1);
    const context = await history.getAcceptedLineItemContext('line-1');
    expect(await history.listCorrectionRules(context!.merchantId!)).toEqual([]);
  });

  it('filters history through the normalized category without mutating line-item raw data', async () => {
    await normalization.assignIdentity({
      lineItemId: 'line-1',
      canonicalName: 'Fresh Milk 1 Liter',
      categoryId: 'category-food-groceries',
      now,
    });

    const receiptsInCategory = await history.listReceipts({
      categoryId: 'category-food-groceries',
    });
    const itemsInCategory = await history.searchItems({
      categoryId: 'category-food-groceries',
    });

    expect(receiptsInCategory.map((entry) => entry.receiptId)).toEqual([
      'receipt-1',
    ]);
    expect(itemsInCategory[0]?.rawName).toBe('MILK 1L');
  });

  async function createAcceptedReceipt(
    id: string,
    merchant: string,
    rawName: string,
    lineItemId: string,
    unitPriceMinor = 8500,
    purchasedAt = '2026-10-01',
  ) {
    await receipts.createDraft({
      id,
      merchantRawName: merchant,
      purchasedAt,
      now,
    });

    await receipts.saveAcceptedReview({
      receiptId: id,
      merchantRawName: merchant,
      purchasedAt,
      totalMinor: unitPriceMinor,
      validationState: 'verified',
      lineItems: [
        {
          id: lineItemId,
          position: 0,
          rawName,
          quantityMilli: 1000,
          unitPriceMinor,
          lineTotalMinor: unitPriceMinor,
          reviewState: 'verified',
        },
      ],
      adjustments: [],
      now,
    });
  }
});
