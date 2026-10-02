import { describe, expect, it } from 'vitest';

import { parseReceipt } from '../src/parser/ReceiptParser';
import {
  makeCorpusDocument,
  parserCorpus,
} from './fixtures/receiptParserCorpus';

describe('declared synthetic parser corpus metrics', () => {
  it('meets the Version 1 synthetic critical-field and line-item targets', () => {
    let criticalFieldChecks = 0;
    let criticalFieldMatches = 0;
    let expectedItems = 0;
    let exactItems = 0;

    for (const corpusCase of parserCorpus) {
      const candidate = parseReceipt(makeCorpusDocument(corpusCase.lines));
      const expected = corpusCase.expected;

      const criticalPairs: Array<[unknown, unknown]> = [
        [candidate.merchant?.rawName ?? null, expected.merchant],
        [candidate.date?.isoDateTime ?? null, expected.date],
        [candidate.summary.totalMinor, expected.totalMinor],
        [candidate.transactionType, expected.transactionType],
      ];

      for (const [actual, target] of criticalPairs) {
        criticalFieldChecks += 1;
        if (actual === target) {
          criticalFieldMatches += 1;
        }
      }

      expectedItems += expected.items.length;

      expected.items.forEach((expectedItem, index) => {
        const actual = candidate.items[index];
        const exact =
          actual?.rawName === expectedItem.rawName &&
          actual.lineTotalMinor === expectedItem.lineTotalMinor &&
          (expectedItem.quantityMilli === undefined ||
            actual.quantityMilli === expectedItem.quantityMilli) &&
          (expectedItem.unitPriceMinor === undefined ||
            actual.unitPriceMinor === expectedItem.unitPriceMinor);

        if (exact) {
          exactItems += 1;
        }
      });
    }

    const criticalFieldAccuracy =
      criticalFieldMatches / Math.max(1, criticalFieldChecks);
    const lineItemExactness = exactItems / Math.max(1, expectedItems);

    expect(parserCorpus).toHaveLength(10);
    expect(criticalFieldAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(lineItemExactness).toBeGreaterThanOrEqual(0.9);

    // Keep the current controlled-fixture result explicit. If a future parser
    // change reduces it, the test should force a conscious corpus review.
    expect(criticalFieldMatches).toBe(criticalFieldChecks);
    expect(exactItems).toBe(expectedItems);
  });
});
