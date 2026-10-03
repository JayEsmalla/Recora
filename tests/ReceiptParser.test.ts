import { describe, expect, it } from 'vitest';

import { parseReceipt } from '../src/parser/ReceiptParser';
import type { OcrDocument, OcrLine } from '../src/ocr/types';

function makeDocument(lines: string[]): OcrDocument {
  const ocrLines: OcrLine[] = lines.map((text, index) => ({
    id: `line-${index}`,
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
        frame: { x: 20, y: 20, width: 960, height: lines.length * 75 },
        confidence: null,
        lines: ocrLines,
      },
    ],
  };
}

describe('parseReceipt', () => {
  it('reconstructs a common grocery receipt with quantity syntax and adjustments', () => {
    const candidate = parseReceipt(
      makeDocument([
        'ABC SUPERMARKET',
        '123 MAIN STREET',
        'DATE 13/03/2026 14:20',
        'MILK 85.00',
        'BREAD 2 @ 40.00 80.00',
        'SUBTOTAL 165.00',
        'DISCOUNT 5.00',
        'VAT 10.00',
        'TOTAL 170.00',
      ]),
    );

    expect(candidate.merchant?.rawName).toBe('ABC SUPERMARKET');
    expect(candidate.date?.isoDateTime).toBe('2026-03-13T14:20:00');
    expect(candidate.items).toHaveLength(2);
    expect(candidate.items[0]).toEqual(
      expect.objectContaining({
        rawName: 'MILK',
        lineTotalMinor: 8500,
      }),
    );
    expect(candidate.items[1]).toEqual(
      expect.objectContaining({
        rawName: 'BREAD',
        quantityMilli: 2000,
        unitPriceMinor: 4000,
        lineTotalMinor: 8000,
      }),
    );
    expect(candidate.summary.subtotalMinor).toBe(16500);
    expect(candidate.summary.totalMinor).toBe(17000);
    expect(candidate.summary.adjustments).toEqual([
      expect.objectContaining({ kind: 'discount', amountMinor: -500 }),
      expect.objectContaining({ kind: 'tax', amountMinor: 1000 }),
    ]);
  });

  it('keeps numeric product descriptors while parsing the rightmost price', () => {
    const candidate = parseReceipt(
      makeDocument([
        'MINI MART',
        '2026-10-13',
        'COKE 1.5L 85.00',
        'TOTAL 85.00',
      ]),
    );

    expect(candidate.items[0]?.rawName).toBe('COKE 1.5L');
    expect(candidate.items[0]?.lineTotalMinor).toBe(8500);
  });

  it('reconstructs a multiline item description without inventing missing subtotal', () => {
    const candidate = parseReceipt(
      makeDocument([
        'ORGANIC SHOP',
        '2026-10-13',
        'PREMIUM ORGANIC',
        'WHOLE MILK 95.00',
        'TOTAL 95.00',
      ]),
    );

    expect(candidate.items).toHaveLength(1);
    expect(candidate.items[0]?.rawName).toBe('PREMIUM ORGANIC WHOLE MILK');
    expect(candidate.summary.subtotalMinor).toBeNull();
    expect(candidate.summary.totalMinor).toBe(9500);
  });

  it('marks ambiguous numeric dates instead of choosing a locale silently', () => {
    const candidate = parseReceipt(
      makeDocument([
        'STORE',
        'DATE 10/03/2026',
        'SOAP 50.00',
        'TOTAL 50.00',
      ]),
    );

    expect(candidate.date?.ambiguous).toBe(true);
    expect(candidate.date?.isoDateTime).toBeNull();
    expect(candidate.date?.alternativeIsoDateTimes).toEqual([
      '2026-10-03',
      '2026-03-10',
    ]);
    expect(candidate.warnings).toContainEqual(
      expect.objectContaining({ code: 'ambiguous-date' }),
    );
  });

  it('detects refund receipts and duplicate-looking item lines', () => {
    const candidate = parseReceipt(
      makeDocument([
        'STORE',
        'REFUND',
        '2026-10-13',
        'SOAP 50.00',
        'SOAP 50.00',
        'TOTAL 100.00',
      ]),
    );

    expect(candidate.transactionType).toBe('refund');
    expect(candidate.items).toHaveLength(2);
    expect(candidate.items[1]?.possibleDuplicateOf).toBe(candidate.items[0]?.id);
    expect(candidate.warnings).toContainEqual(
      expect.objectContaining({ code: 'possible-duplicate-line' }),
    );
  });

  it('calls out duplicate-looking rows that cross receipt photos', () => {
    const document = makeDocument([
      'STORE',
      '2026-10-13',
      'SOAP 50.00',
      'SOAP 50.00',
      'TOTAL 100.00',
    ]);
    document.blocks[0]!.lines[2]!.id = 'page-1::line-2';
    document.blocks[0]!.lines[3]!.id = 'page-2::line-3';

    const candidate = parseReceipt(document);
    const warning = candidate.warnings.find(
      (item) => item.code === 'possible-duplicate-line',
    );

    expect(warning?.message).toContain('more than one receipt photo');
    expect(warning?.message).toContain('photo overlap');
  });

  it('does not misread total item count as the final monetary total', () => {
    const candidate = parseReceipt(
      makeDocument([
        'STORE',
        '2026-10-13',
        'MILK 85.00',
        'TOTAL ITEMS 1',
        'TOTAL 85.00',
      ]),
    );

    expect(candidate.summary.totalMinor).toBe(8500);
    expect(candidate.warnings).not.toContainEqual(
      expect.objectContaining({ code: 'multiple-total-candidates' }),
    );
  });

  it('surfaces multiple total candidates, preserves alternatives, and uses the bottom-most one', () => {
    const candidate = parseReceipt(
      makeDocument([
        'STORE',
        '2026-10-13',
        'MILK 85.00',
        'TOTAL AMOUNT 85.00',
        'GRAND TOTAL 80.00',
      ]),
    );

    expect(candidate.summary.totalMinor).toBe(8000);
    expect(candidate.summary.totalSourceIds).toEqual(['line-4']);
    expect(candidate.summary.totalAlternatives).toEqual([
      { amountMinor: 8500, observationIds: ['line-3'] },
      { amountMinor: 8000, observationIds: ['line-4'] },
    ]);
    expect(candidate.warnings).toContainEqual(
      expect.objectContaining({ code: 'multiple-total-candidates' }),
    );
  });

  it('supports merchant-specific ignored lines without changing baseline parsing', () => {
    const candidate = parseReceipt(
      makeDocument([
        'SHOPMART',
        'LOYALTY CLUB',
        '2026-10-13',
        'RICE 100.00',
        'TOTAL 100.00',
      ]),
      {
        profiles: [
          {
            id: 'shopmart',
            merchantPatterns: [/SHOPMART/i],
            ignoredLinePatterns: [/LOYALTY CLUB/i],
          },
        ],
      },
    );

    expect(candidate.merchant?.rawName).toBe('SHOPMART');
    expect(candidate.items[0]?.rawName).toBe('RICE');
  });
});
