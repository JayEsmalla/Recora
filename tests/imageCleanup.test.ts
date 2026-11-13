import { describe, expect, it } from 'vitest';

import { selectOrphanedReceiptImageUris } from '../src/capture/imageCleanup';

describe('receipt image cleanup selection', () => {
  it('keeps every database-referenced image and selects only orphaned files', () => {
    const candidates = [
      'file:///recora/receipts/receipt-1.jpg',
      'file:///recora/receipts/receipt-2.jpg',
      'file:///recora/receipts/orphan.jpg',
    ];
    const referenced = [
      'file:///recora/receipts/receipt-1.jpg',
      'file:///recora/receipts/receipt-2.jpg',
    ];

    expect(selectOrphanedReceiptImageUris(candidates, referenced)).toEqual([
      'file:///recora/receipts/orphan.jpg',
    ]);
  });

  it('protects an in-flight retained image before its SQLite row commits', () => {
    const candidate = 'file:///recora/receipts/new-receipt-page-0.jpg';
    expect(selectOrphanedReceiptImageUris(
      [candidate, 'file:///recora/receipts/orphan.jpg'],
      [],
      [candidate],
    )).toEqual(['file:///recora/receipts/orphan.jpg']);
  });

  it('does not delete anything when every retained image is referenced', () => {
    const candidates = [
      'file:///recora/receipts/receipt-1.jpg',
      'file:///recora/receipts/receipt-2.jpg',
    ];

    expect(selectOrphanedReceiptImageUris(candidates, candidates)).toEqual([]);
  });
});
