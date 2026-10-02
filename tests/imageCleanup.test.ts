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

  it('does not delete anything when every retained image is referenced', () => {
    const candidates = [
      'file:///recora/receipts/receipt-1.jpg',
      'file:///recora/receipts/receipt-2.jpg',
    ];

    expect(selectOrphanedReceiptImageUris(candidates, candidates)).toEqual([]);
  });
});
