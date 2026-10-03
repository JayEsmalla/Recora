import { describe, expect, it } from 'vitest';

import { mergeOcrDocuments } from '../src/ocr/mergeOcrDocuments';
import type { OcrDocument } from '../src/ocr/types';

describe('mergeOcrDocuments', () => {
  it('stacks pages in order without stitching image pixels', () => {
    const first = document('FIRST PAGE', 1000, 1200, 'block', 'line', 20);
    const second = document('SECOND PAGE', 800, 900, 'block', 'line', 30);

    const merged = mergeOcrDocuments([first, second]);

    expect(merged.imageWidth).toBe(1000);
    expect(merged.imageHeight).toBe(2180);
    expect(merged.rawText).toBe('FIRST PAGE\nSECOND PAGE');
    expect(merged.blocks.map((block) => block.id)).toEqual([
      'page-1::block',
      'page-2::block',
    ]);
    expect(merged.blocks[0]!.frame.y).toBe(20);
    expect(merged.blocks[1]!.frame.y).toBe(1310);
    expect(merged.blocks[1]!.lines[0]!.id).toBe('page-2::line');
    expect(merged.blocks[1]!.lines[0]!.frame.y).toBe(1310);
  });

  it('returns a single page unchanged', () => {
    const single = document('ONLY PAGE', 600, 1000, 'b', 'l', 10);
    expect(mergeOcrDocuments([single])).toBe(single);
  });

  it('rejects an empty page set', () => {
    expect(() => mergeOcrDocuments([])).toThrow(
      'At least one OCR document is required.',
    );
  });
});

function document(
  rawText: string,
  imageWidth: number,
  imageHeight: number,
  blockId: string,
  lineId: string,
  y: number,
): OcrDocument {
  return {
    engine: 'fixture',
    imageWidth,
    imageHeight,
    rawText,
    blocks: [
      {
        id: blockId,
        text: rawText,
        frame: { x: 10, y, width: 500, height: 40 },
        confidence: null,
        lines: [
          {
            id: lineId,
            text: rawText,
            frame: { x: 20, y, width: 450, height: 30 },
            confidence: null,
            elements: [
              {
                id: 'element',
                text: rawText,
                frame: { x: 20, y, width: 450, height: 30 },
                confidence: null,
              },
            ],
          },
        ],
      },
    ],
  };
}
