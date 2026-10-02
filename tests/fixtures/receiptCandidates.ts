import type { ReceiptCandidate } from '../../src/parser/types';

export function validCandidate(): ReceiptCandidate {
  return {
    parserVersion: 'test',
    merchant: {
      rawName: 'ABC STORE',
      observationIds: ['merchant'],
    },
    date: {
      raw: '2026-10-03',
      isoDateTime: '2026-10-03',
      ambiguous: false,
      observationIds: ['date'],
    },
    transactionType: 'purchase',
    items: [
      {
        id: 'item-1',
        position: 0,
        rawName: 'BREAD',
        quantityMilli: 2000,
        rawQuantityText: '2 @ 40.00',
        unitPriceMinor: 4000,
        lineTotalMinor: 8000,
        possibleDuplicateOf: null,
        observationIds: ['item-1'],
      },
      {
        id: 'item-2',
        position: 1,
        rawName: 'MILK',
        quantityMilli: null,
        rawQuantityText: null,
        unitPriceMinor: null,
        lineTotalMinor: 8500,
        possibleDuplicateOf: null,
        observationIds: ['item-2'],
      },
    ],
    summary: {
      subtotalMinor: 16500,
      subtotalSourceIds: ['subtotal'],
      totalMinor: 17000,
      totalSourceIds: ['total'],
      adjustments: [
        {
          id: 'discount-1',
          position: 0,
          kind: 'discount',
          label: 'DISCOUNT',
          amountMinor: -500,
          observationIds: ['discount'],
        },
        {
          id: 'tax-1',
          position: 1,
          kind: 'tax',
          label: 'VAT',
          amountMinor: 1000,
          observationIds: ['tax'],
        },
      ],
    },
    warnings: [],
  };
}
