import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { ReceiptRepository } from '../src/data/repositories/ReceiptRepository';
import {
  createSqlJsConnection,
  type SqlJsConnection,
} from './helpers/SqlJsConnection';

const now = '2026-10-03T00:00:00.000Z';

describe('ReceiptRepository review integrity', () => {
  let database: SqlJsConnection;
  let repository: ReceiptRepository;

  beforeEach(async () => {
    database = await createSqlJsConnection();
    await migrateDatabase(database);
    repository = new ReceiptRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  it('preserves raw OCR evidence while organizational review fields change', async () => {
    await repository.createDraft({
      id: 'receipt-1',
      rawOcrText: 'ORIGINAL OCR EVIDENCE',
      now,
    });

    await repository.replaceReviewData({
      receiptId: 'receipt-1',
      merchantRawName: 'Corrected Store',
      totalMinor: 8500,
      validationState: 'review',
      lineItems: [
        {
          id: 'item-1',
          position: 0,
          rawName: 'Corrected Milk',
          lineTotalMinor: 8500,
        },
      ],
      adjustments: [],
      now,
    });

    const receipt = await repository.getById('receipt-1');
    expect(receipt?.rawOcrText).toBe('ORIGINAL OCR EVIDENCE');
    expect(receipt?.merchantRawName).toBe('Corrected Store');
  });

  it('loads editable review rows in stable position order', async () => {
    await repository.createDraft({ id: 'receipt-1', now });
    await repository.replaceReviewData({
      receiptId: 'receipt-1',
      merchantRawName: 'Store',
      totalMinor: 3000,
      validationState: 'review',
      lineItems: [
        { id: 'item-b', position: 1, rawName: 'B', lineTotalMinor: 2000 },
        { id: 'item-a', position: 0, rawName: 'A', lineTotalMinor: 1000 },
      ],
      adjustments: [
        {
          id: 'tax',
          position: 0,
          kind: 'tax',
          label: 'VAT',
          amountMinor: 100,
        },
      ],
      now,
    });

    const review = await repository.getReviewData('receipt-1');

    expect(review?.lineItems.map((item) => item.id)).toEqual([
      'item-a',
      'item-b',
    ]);
    expect(review?.adjustments[0]?.kind).toBe('tax');
  });

  it('accepts the final reviewed values and children in one transaction', async () => {
    await repository.createDraft({ id: 'receipt-1', now });
    await repository.replaceReviewData({
      receiptId: 'receipt-1',
      validationState: 'review',
      lineItems: [],
      adjustments: [],
      now,
    });

    await repository.saveAcceptedReview({
      receiptId: 'receipt-1',
      merchantRawName: 'Final Store',
      subtotalMinor: 10000,
      totalMinor: 9500,
      validationState: 'verified',
      lineItems: [
        {
          id: 'item-1',
          position: 0,
          rawName: 'Rice',
          lineTotalMinor: 10000,
          confidenceBasisPoints: 9000,
          reviewState: 'verified',
        },
      ],
      adjustments: [
        {
          id: 'discount',
          position: 0,
          kind: 'discount',
          label: 'Discount',
          amountMinor: -500,
          confidenceBasisPoints: 8500,
          reviewState: 'verified',
        },
      ],
      now,
    });

    const review = await repository.getReviewData('receipt-1');
    expect(review?.receipt.status).toBe('accepted');
    expect(review?.receipt.merchantRawName).toBe('Final Store');
    expect(review?.lineItems[0]?.rawName).toBe('Rice');
    expect(review?.adjustments[0]?.amountMinor).toBe(-500);
  });

  it('persists long reviewed receipts across multiple batched child inserts', async () => {
    await repository.createDraft({ id: 'long-receipt', now });

    const lineItems = Array.from({ length: 121 }, (_, position) => ({
      id: `long-item-${position}`,
      position,
      rawName: `ITEM ${position}`,
      lineTotalMinor: 100,
      reviewState: 'verified' as const,
    }));
    const adjustments = Array.from({ length: 101 }, (_, position) => ({
      id: `long-adjustment-${position}`,
      position,
      kind: 'other' as const,
      label: `Adjustment ${position}`,
      amountMinor: 1,
      reviewState: 'verified' as const,
    }));

    await repository.replaceReviewData({
      receiptId: 'long-receipt',
      validationState: 'review',
      lineItems,
      adjustments,
      now,
    });

    const review = await repository.getReviewData('long-receipt');
    expect(review?.lineItems).toHaveLength(121);
    expect(review?.adjustments).toHaveLength(101);
    expect(review?.lineItems[120]?.rawName).toBe('ITEM 120');
    expect(review?.adjustments[100]?.label).toBe('Adjustment 100');
  });

  it('rolls back acceptance completely when child persistence fails', async () => {
    await repository.createDraft({ id: 'receipt-1', now });
    await repository.replaceReviewData({
      receiptId: 'receipt-1',
      merchantRawName: 'Before',
      totalMinor: 1000,
      validationState: 'review',
      lineItems: [
        {
          id: 'original',
          position: 0,
          rawName: 'Original Item',
          lineTotalMinor: 1000,
        },
      ],
      adjustments: [],
      now,
    });

    await expect(
      repository.saveAcceptedReview({
        receiptId: 'receipt-1',
        merchantRawName: 'Should Roll Back',
        totalMinor: 2000,
        validationState: 'verified',
        lineItems: [
          {
            id: 'duplicate-a',
            position: 0,
            rawName: 'A',
            lineTotalMinor: 1000,
          },
          {
            id: 'duplicate-b',
            position: 0,
            rawName: 'B',
            lineTotalMinor: 1000,
          },
        ],
        adjustments: [],
        now,
      }),
    ).rejects.toThrow();

    const review = await repository.getReviewData('receipt-1');
    expect(review?.receipt.status).toBe('review');
    expect(review?.receipt.merchantRawName).toBe('Before');
    expect(review?.lineItems.map((item) => item.id)).toEqual(['original']);
  });

  it('lists only unfinished receipts for recovery', async () => {
    await repository.createDraft({ id: 'draft', now });
    await repository.createDraft({ id: 'accepted', now });
    await repository.replaceReviewData({
      receiptId: 'accepted',
      validationState: 'verified',
      lineItems: [],
      adjustments: [],
      now,
    });
    await repository.saveAcceptedReview({
      receiptId: 'accepted',
      validationState: 'verified',
      lineItems: [],
      adjustments: [],
      now,
    });

    const unfinished = await repository.listUnfinished();
    expect(unfinished.map((receipt) => receipt.id)).toEqual(['draft']);
  });
});
