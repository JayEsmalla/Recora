import type { OcrDocument, OcrLine } from '../../src/ocr/types';
import type { TransactionType } from '../../src/domain/receipt';

export interface ParserCorpusExpectedItem {
  rawName: string;
  lineTotalMinor: number;
  quantityMilli?: number | null;
  unitPriceMinor?: number | null;
}

export interface ParserCorpusCase {
  id: string;
  lines: string[];
  expected: {
    merchant: string;
    date: string;
    totalMinor: number;
    transactionType: TransactionType;
    items: ParserCorpusExpectedItem[];
  };
}

export const parserCorpus: readonly ParserCorpusCase[] = [
  {
    id: 'simple-grocery',
    lines: [
      'ALPHA MART',
      '2026-10-01',
      'MILK 85.00',
      'BREAD 40.00',
      'SUBTOTAL 125.00',
      'TOTAL 125.00',
    ],
    expected: {
      merchant: 'ALPHA MART',
      date: '2026-10-01',
      totalMinor: 12500,
      transactionType: 'purchase',
      items: [
        { rawName: 'MILK', lineTotalMinor: 8500 },
        { rawName: 'BREAD', lineTotalMinor: 4000 },
      ],
    },
  },
  {
    id: 'quantity-discount-tax',
    lines: [
      'BETA SUPERMARKET',
      'DATE 13/03/2026 14:20',
      'RICE 2 @ 50.00 100.00',
      'OIL 120.00',
      'SUBTOTAL 220.00',
      'DISCOUNT 20.00',
      'VAT 10.00',
      'TOTAL 210.00',
    ],
    expected: {
      merchant: 'BETA SUPERMARKET',
      date: '2026-03-13T14:20:00',
      totalMinor: 21000,
      transactionType: 'purchase',
      items: [
        {
          rawName: 'RICE',
          quantityMilli: 2000,
          unitPriceMinor: 5000,
          lineTotalMinor: 10000,
        },
        { rawName: 'OIL', lineTotalMinor: 12000 },
      ],
    },
  },
  {
    id: 'multiline-named-date',
    lines: [
      'GAMMA SHOP',
      'October 2, 2026 09:15',
      'PREMIUM ORGANIC',
      'WHOLE MILK 95.00',
      'TOTAL 95.00',
    ],
    expected: {
      merchant: 'GAMMA SHOP',
      date: '2026-10-02T09:15:00',
      totalMinor: 9500,
      transactionType: 'purchase',
      items: [
        {
          rawName: 'PREMIUM ORGANIC WHOLE MILK',
          lineTotalMinor: 9500,
        },
      ],
    },
  },
  {
    id: 'numeric-product-description',
    lines: [
      'DELTA STORE',
      '2026/10/03',
      'COKE 1.5L 85.00',
      'TOTAL 85.00',
    ],
    expected: {
      merchant: 'DELTA STORE',
      date: '2026-10-03',
      totalMinor: 8500,
      transactionType: 'purchase',
      items: [{ rawName: 'COKE 1.5L', lineTotalMinor: 8500 }],
    },
  },
  {
    id: 'service-charge',
    lines: [
      'EPSILON MART',
      '2026-10-04',
      'SOAP 50.00',
      'SERVICE CHARGE 5.00',
      'TOTAL 55.00',
    ],
    expected: {
      merchant: 'EPSILON MART',
      date: '2026-10-04',
      totalMinor: 5500,
      transactionType: 'purchase',
      items: [{ rawName: 'SOAP', lineTotalMinor: 5000 }],
    },
  },
  {
    id: 'rounding',
    lines: [
      'ZETA STORE',
      '2026-10-05',
      'SNACK 99.99',
      'ROUNDING 0.01',
      'TOTAL 100.00',
    ],
    expected: {
      merchant: 'ZETA STORE',
      date: '2026-10-05',
      totalMinor: 10000,
      transactionType: 'purchase',
      items: [{ rawName: 'SNACK', lineTotalMinor: 9999 }],
    },
  },
  {
    id: 'currency-prefixes',
    lines: [
      'ETA MARKET',
      '2026-10-06',
      'COFFEE PHP 120.00',
      'SUGAR ₱80.00',
      'TOTAL PHP 200.00',
    ],
    expected: {
      merchant: 'ETA MARKET',
      date: '2026-10-06',
      totalMinor: 20000,
      transactionType: 'purchase',
      items: [
        { rawName: 'COFFEE', lineTotalMinor: 12000 },
        { rawName: 'SUGAR', lineTotalMinor: 8000 },
      ],
    },
  },
  {
    id: 'grouped-amount',
    lines: [
      'THETA MART',
      '2026-10-07',
      'APPLIANCE 1,250.00',
      'TOTAL 1,250.00',
    ],
    expected: {
      merchant: 'THETA MART',
      date: '2026-10-07',
      totalMinor: 125000,
      transactionType: 'purchase',
      items: [{ rawName: 'APPLIANCE', lineTotalMinor: 125000 }],
    },
  },
  {
    id: 'quantity-x',
    lines: [
      'IOTA SHOP',
      '2026-10-08',
      'WATER 3 x 20.00 60.00',
      'TOTAL 60.00',
    ],
    expected: {
      merchant: 'IOTA SHOP',
      date: '2026-10-08',
      totalMinor: 6000,
      transactionType: 'purchase',
      items: [
        {
          rawName: 'WATER',
          quantityMilli: 3000,
          unitPriceMinor: 2000,
          lineTotalMinor: 6000,
        },
      ],
    },
  },
  {
    id: 'refund',
    lines: [
      'KAPPA STORE',
      'REFUND',
      '2026-10-09',
      'RETURNED SOAP 50.00',
      'TOTAL 50.00',
    ],
    expected: {
      merchant: 'KAPPA STORE',
      date: '2026-10-09',
      totalMinor: 5000,
      transactionType: 'refund',
      items: [{ rawName: 'RETURNED SOAP', lineTotalMinor: 5000 }],
    },
  },
];

export function makeCorpusDocument(lines: readonly string[]): OcrDocument {
  const ocrLines: OcrLine[] = lines.map((text, index) => ({
    id: 'line-' + index,
    text,
    frame: {
      x: 40,
      y: 40 + index * 70,
      width: 900,
      height: 42,
    },
    confidence: null,
    elements: [],
  }));

  return {
    engine: 'fixture',
    imageWidth: 1000,
    imageHeight: Math.max(1600, lines.length * 90),
    rawText: lines.join('\n'),
    blocks: [
      {
        id: 'block-0',
        text: lines.join('\n'),
        frame: {
          x: 20,
          y: 20,
          width: 960,
          height: lines.length * 75,
        },
        confidence: null,
        lines: ocrLines,
      },
    ],
  };
}
