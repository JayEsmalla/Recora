import { describe, expect, it } from 'vitest';

import {
  containsPaymentCardNumber,
  redactPaymentCardNumbers,
  redactSensitiveOcr,
} from '../src/ocr/redactSensitiveOcr';
import type { OcrDocument } from '../src/ocr/types';

describe('sensitive OCR redaction', () => {
  it('redacts a Luhn-valid payment card number while preserving the last four digits', () => {
    expect(
      redactPaymentCardNumbers('VISA 4111 1111 1111 1111 APPROVED'),
    ).toBe('VISA [REDACTED CARD **** 1111] APPROVED');
  });

  it('does not redact ordinary receipt numbers that fail Luhn validation', () => {
    expect(redactPaymentCardNumbers('OR 1234567890123')).toBe(
      'OR 1234567890123',
    );
    expect(containsPaymentCardNumber('OR 1234567890123')).toBe(false);
  });

  it('removes digit-bearing OCR elements from a line containing a full card number', () => {
    const document: OcrDocument = {
      engine: 'fixture',
      imageWidth: 1000,
      imageHeight: 2000,
      rawText: 'CARD 4111 1111 1111 1111',
      blocks: [
        {
          id: 'b0',
          text: 'CARD 4111 1111 1111 1111',
          frame: { x: 0, y: 0, width: 900, height: 80 },
          confidence: null,
          lines: [
            {
              id: 'b0-l0',
              text: 'CARD 4111 1111 1111 1111',
              frame: { x: 0, y: 0, width: 900, height: 80 },
              confidence: null,
              elements: [
                {
                  id: 'b0-l0-e0',
                  text: 'CARD',
                  frame: { x: 0, y: 0, width: 100, height: 80 },
                  confidence: null,
                },
                {
                  id: 'b0-l0-e1',
                  text: '4111',
                  frame: { x: 120, y: 0, width: 100, height: 80 },
                  confidence: null,
                },
                {
                  id: 'b0-l0-e2',
                  text: '1111',
                  frame: { x: 240, y: 0, width: 100, height: 80 },
                  confidence: null,
                },
              ],
            },
          ],
        },
      ],
    };

    const redacted = redactSensitiveOcr(document);

    expect(redacted.rawText).not.toContain('4111 1111 1111 1111');
    expect(redacted.blocks[0]?.lines[0]?.text).toContain('[REDACTED CARD');
    expect(redacted.blocks[0]?.lines[0]?.elements[0]?.text).toBe('CARD');
    expect(redacted.blocks[0]?.lines[0]?.elements[1]?.text).toBe('[REDACTED]');
    expect(redacted.blocks[0]?.lines[0]?.elements[2]?.text).toBe('[REDACTED]');
  });
});
