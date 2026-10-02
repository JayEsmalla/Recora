import { describe, expect, it } from 'vitest';

import { normalizeMlKitResult } from '../src/ocr/normalizeOcrResult';

describe('normalizeMlKitResult', () => {
  it('creates stable observation ids and preserves spatial hierarchy', () => {
    const document = normalizeMlKitResult(
      {
        text: 'STORE\nMILK 85.00',
        blocks: [
          {
            text: 'STORE\nMILK 85.00',
            frame: { x: 10, y: 20, width: 400, height: 180 },
            lines: [
              {
                text: 'STORE',
                frame: { x: 20, y: 30, width: 160, height: 40 },
                elements: [
                  {
                    text: 'STORE',
                    frame: { x: 20, y: 30, width: 160, height: 40 },
                  },
                ],
              },
              {
                text: 'MILK 85.00',
                frame: { x: 20, y: 100, width: 300, height: 40 },
                elements: [
                  {
                    text: 'MILK',
                    frame: { x: 20, y: 100, width: 100, height: 40 },
                  },
                  {
                    text: '85.00',
                    frame: { x: 220, y: 100, width: 100, height: 40 },
                  },
                ],
              },
            ],
          },
        ],
      },
      600,
      1000,
      'test-engine',
    );

    expect(document.rawText).toBe('STORE\nMILK 85.00');
    expect(document.blocks[0]?.id).toBe('b0');
    expect(document.blocks[0]?.lines[1]?.id).toBe('b0-l1');
    expect(document.blocks[0]?.lines[1]?.elements[1]?.id).toBe('b0-l1-e1');
    expect(document.blocks[0]?.confidence).toBeNull();
  });

  it('clamps malformed native frames to the source image bounds', () => {
    const document = normalizeMlKitResult(
      {
        text: 'TOTAL',
        blocks: [
          {
            text: 'TOTAL',
            frame: { x: -10, y: 90, width: 500, height: 100 },
            lines: [],
          },
        ],
      },
      200,
      100,
      'test-engine',
    );

    expect(document.blocks[0]?.frame).toEqual({
      x: 0,
      y: 90,
      width: 200,
      height: 10,
    });
  });

  it('rejects invalid image dimensions', () => {
    expect(() =>
      normalizeMlKitResult(
        { text: '', blocks: [] },
        0,
        100,
        'test-engine',
      ),
    ).toThrow('OCR image dimensions must be positive');
  });
});
