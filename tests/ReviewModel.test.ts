import { describe, expect, it } from 'vitest';

import {
  createBlankAdjustment,
  createBlankReviewItem,
  createReviewDraft,
  evaluateReviewDraft,
} from '../src/review/ReviewModel';
import { validCandidate } from './fixtures/receiptCandidates';

const now = new Date('2026-10-03T12:00:00Z');

describe('ReviewModel', () => {
  it('creates receipt-scoped editable values from parser output', () => {
    const draft = createReviewDraft(validCandidate(), 'receipt-1');

    expect(draft.merchantName).toBe('ABC STORE');
    expect(draft.purchasedAtText).toBe('2026-10-03');
    expect(draft.subtotalText).toBe('165.00');
    expect(draft.totalText).toBe('170.00');
    expect(draft.items[0]).toEqual(
      expect.objectContaining({
        id: 'receipt-1-item-1',
        rawName: 'BREAD',
        quantityText: '2',
        unitPriceText: '40.00',
        lineTotalText: '80.00',
      }),
    );
  });

  it('recalculates arithmetic validation immediately after edits', () => {
    const draft = createReviewDraft(validCandidate(), 'receipt-1');
    draft.items[0]!.lineTotalText = '70.00';

    expect(evaluateReviewDraft(draft, now).validation.state).toBe('mismatch');

    draft.items[0]!.lineTotalText = '80.00';
    expect(evaluateReviewDraft(draft, now).validation.state).toBe('verified');
  });

  it('keeps invalid user input visible and reports it before persistence', () => {
    const draft = createReviewDraft(validCandidate(), 'receipt-1');
    draft.totalText = 'PHP nope';
    draft.items[0]!.quantityText = '1.2345';

    const evaluation = evaluateReviewDraft(draft, now);

    expect(evaluation.inputErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldPath: 'receipt.total' }),
        expect.objectContaining({
          fieldPath: 'items.receipt-1-item-1.quantity',
        }),
      ]),
    );
  });

  it('treats invalid manual dates as review-required rather than inventing a date', () => {
    const draft = createReviewDraft(validCandidate(), 'receipt-1');
    draft.purchasedAtText = 'sometime yesterday';

    const evaluation = evaluateReviewDraft(draft, now);

    expect(evaluation.validation.state).toBe('review');
    expect(evaluation.validation.issues).toContainEqual(
      expect.objectContaining({ code: 'ambiguous-date' }),
    );
  });

  it('preserves ISO local date-times emitted by the parser', () => {
    const candidate = validCandidate();
    candidate.date = {
      raw: '13/10/2026 14:20',
      isoDateTime: '2026-10-13T14:20:00',
      ambiguous: false,
      observationIds: ['date'],
    };

    const draft = createReviewDraft(candidate, 'receipt-1');
    const evaluation = evaluateReviewDraft(
      draft,
      new Date('2026-10-14T00:00:00Z'),
    );

    expect(evaluation.validation.issues).not.toContainEqual(
      expect.objectContaining({ code: 'ambiguous-date' }),
    );
  });

  it('marks duplicate item name-and-amount rows for review after manual edits', () => {
    const draft = createReviewDraft(validCandidate(), 'receipt-1');
    draft.items.push({
      ...draft.items[1]!,
      id: 'receipt-1-copy',
    });
    draft.subtotalText = '250.00';
    draft.totalText = '255.00';

    const evaluation = evaluateReviewDraft(draft, now);

    expect(evaluation.validation.state).toBe('review');
    expect(evaluation.validation.issues).toContainEqual(
      expect.objectContaining({ code: 'possible-duplicate-line' }),
    );
  });

  it('creates receipt-scoped blank item and adjustment rows', () => {
    expect(createBlankReviewItem('receipt-9', 1).id).toContain(
      'receipt-9-manual-item-',
    );
    expect(createBlankAdjustment('receipt-9', 1)).toEqual(
      expect.objectContaining({
        kind: 'discount',
        label: 'Discount',
        amountText: '',
      }),
    );
  });
});
