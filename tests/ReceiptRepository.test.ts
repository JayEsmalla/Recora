import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { ReceiptRepository } from '../src/data/repositories/ReceiptRepository';
import { createSqlJsConnection, type SqlJsConnection } from './helpers/SqlJsConnection';

describe('ReceiptRepository', () => {
  let database: SqlJsConnection;
  let repository: ReceiptRepository;
  const now = '2026-10-03T00:00:00.000Z';

  beforeEach(async () => {
    database = await createSqlJsConnection();
    await migrateDatabase(database);
    repository = new ReceiptRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  it('moves a draft through review to accepted history', async () => {
    await repository.createDraft({
      id: 'receipt-1',
      imageUri: 'file:///private/receipt-1.jpg',
      now,
    });

    await repository.replaceReviewData({
      receiptId: 'receipt-1',
      merchantRawName: 'Sample Store',
      purchasedAt: now,
      subtotalMinor: 20000,
      totalMinor: 19000,
      validationState: 'verified',
      lineItems: [
        {
          id: 'item-1',
          position: 0,
          rawName: 'ITEM A',
          quantityMilli: 1000,
          unitPriceMinor: 20000,
          lineTotalMinor: 20000,
          reviewState: 'verified',
        },
      ],
      adjustments: [
        {
          id: 'adjustment-1',
          position: 0,
          kind: 'discount',
          label: 'Discount',
          amountMinor: -1000,
          reviewState: 'verified',
        },
      ],
      now,
    });

    expect((await repository.getById('receipt-1'))?.status).toBe('review');
    expect(await repository.listAccepted()).toHaveLength(0);

    await repository.acceptReceipt('receipt-1', now);

    const accepted = await repository.listAccepted();
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.merchantRawName).toBe('Sample Store');
    expect(accepted[0]?.totalMinor).toBe(19000);
  });

  it('preserves raw OCR evidence while storing corrected review data', async () => {
    await repository.createDraft({
      id: 'receipt-ocr',
      rawOcrText: 'RAW OCR TEXT',
      now,
    });

    await repository.replaceReviewData({
      receiptId: 'receipt-ocr',
      merchantRawName: 'Corrected Store',
      totalMinor: 5000,
      validationState: 'review',
      lineItems: [],
      adjustments: [],
      now,
    });

    const receipt = await repository.getById('receipt-ocr');
    expect(receipt?.rawOcrText).toBe('RAW OCR TEXT');
    expect(receipt?.merchantRawName).toBe('Corrected Store');
  });

  it('lists retained image references for startup orphan cleanup', async () => {
    await repository.createDraft({
      id: 'with-image',
      imageUri: 'file:///private/with-image.jpg',
      imageWidth: 1000,
      imageHeight: 2000,
      now,
    });
    await repository.createDraft({
      id: 'legacy-image-without-dimensions',
      imageUri: 'file:///private/legacy-image.jpg',
      now,
    });
    await repository.createDraft({
      id: 'without-image',
      now,
    });

    expect((await repository.listImageUris()).sort()).toEqual([
      'file:///private/legacy-image.jpg',
      'file:///private/with-image.jpg',
    ]);
  });

  it('stores up to five ordered photos for one receipt', async () => {
    await repository.createDraft({
      id: 'long-receipt',
      imageUri: 'file:///private/long-0.jpg',
      imageWidth: 1000,
      imageHeight: 2000,
      now,
    });

    for (let position = 1; position < 5; position += 1) {
      await repository.addPage({
        receiptId: 'long-receipt',
        imageUri: `file:///private/long-${position}.jpg`,
        imageWidth: 1000,
        imageHeight: 2000,
        now,
      });
    }

    const pages = await repository.listPages('long-receipt');
    expect(pages.map((page) => page.position)).toEqual([0, 1, 2, 3, 4]);
    expect(await repository.listReceiptImageUris('long-receipt')).toEqual([
      'file:///private/long-0.jpg',
      'file:///private/long-1.jpg',
      'file:///private/long-2.jpg',
      'file:///private/long-3.jpg',
      'file:///private/long-4.jpg',
    ]);

    await expect(
      repository.addPage({
        receiptId: 'long-receipt',
        imageUri: 'file:///private/long-5.jpg',
        imageWidth: 1000,
        imageHeight: 2000,
        now,
      }),
    ).rejects.toThrow('at most 5 photos');
  });

  it('lists unaccepted drafts separately from accepted history', async () => {
    await repository.createDraft({ id: 'pending', now });
    await repository.createDraft({ id: 'accepted', now });
    await repository.replaceReviewData({
      receiptId: 'accepted',
      totalMinor: 100,
      validationState: 'verified',
      lineItems: [],
      adjustments: [],
      now,
    });
    await repository.acceptReceipt('accepted', now);

    expect((await repository.listUnfinished()).map((receipt) => receipt.id)).toEqual([
      'pending',
    ]);
    expect((await repository.listAccepted()).map((receipt) => receipt.id)).toEqual([
      'accepted',
    ]);
  });

  it('does not allow an unreviewed draft to become accepted', async () => {
    await repository.createDraft({ id: 'receipt-1', now });

    await expect(repository.acceptReceipt('receipt-1', now)).rejects.toThrow(
      'Only reviewed receipts can be accepted.',
    );
  });

  it('deletes dependent line items and adjustments with the receipt', async () => {
    await repository.createDraft({ id: 'receipt-1', now });
    await repository.replaceReviewData({
      receiptId: 'receipt-1',
      validationState: 'review',
      lineItems: [
        {
          id: 'item-1',
          position: 0,
          rawName: 'ITEM A',
        },
      ],
      adjustments: [
        {
          id: 'adjustment-1',
          position: 0,
          kind: 'tax',
          label: 'VAT',
          amountMinor: 100,
        },
      ],
      now,
    });

    expect(await repository.deleteReceipt('receipt-1')).toBe(true);

    const itemCount = await database.first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM line_items;',
    );
    const adjustmentCount = await database.first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM receipt_adjustments;',
    );
    const pageCount = await database.first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM receipt_pages;',
    );

    expect(itemCount?.count).toBe(0);
    expect(adjustmentCount?.count).toBe(0);
    expect(pageCount?.count).toBe(0);
  });
});
