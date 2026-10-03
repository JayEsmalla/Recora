import type {
  OcrBlock,
  OcrDocument,
  OcrElement,
  OcrLine,
} from './types';

const PAGE_GAP = 80;

/**
 * Combines independently recognized receipt pages into one virtual document.
 *
 * Pages are stacked vertically in capture order instead of stitching image
 * pixels. This keeps native OCR memory bounded to one photo at a time while
 * preserving deterministic top-to-bottom geometry for the receipt parser.
 */
export function mergeOcrDocuments(
  documents: readonly OcrDocument[],
): OcrDocument {
  if (documents.length === 0) {
    throw new Error('At least one OCR document is required.');
  }

  if (documents.length === 1) {
    return documents[0]!;
  }

  let yOffset = 0;
  const blocks: OcrBlock[] = [];

  documents.forEach((document, pageIndex) => {
    for (const block of document.blocks) {
      blocks.push(prefixBlock(block, pageIndex, yOffset));
    }

    yOffset += document.imageHeight;
    if (pageIndex < documents.length - 1) {
      yOffset += PAGE_GAP;
    }
  });

  return {
    engine: documents.map((document) => document.engine).join('+'),
    imageWidth: Math.max(...documents.map((document) => document.imageWidth)),
    imageHeight: yOffset,
    rawText: documents
      .map((document) => document.rawText.trim())
      .filter(Boolean)
      .join('\n'),
    blocks,
  };
}

function prefixBlock(
  block: OcrBlock,
  pageIndex: number,
  yOffset: number,
): OcrBlock {
  const prefix = `page-${pageIndex + 1}::`;

  return {
    ...block,
    id: prefix + block.id,
    frame: {
      ...block.frame,
      y: block.frame.y + yOffset,
    },
    lines: block.lines.map((line) =>
      prefixLine(line, prefix, yOffset),
    ),
  };
}

function prefixLine(
  line: OcrLine,
  prefix: string,
  yOffset: number,
): OcrLine {
  return {
    ...line,
    id: prefix + line.id,
    frame: {
      ...line.frame,
      y: line.frame.y + yOffset,
    },
    elements: line.elements.map((element) =>
      prefixElement(element, prefix, yOffset),
    ),
  };
}

function prefixElement(
  element: OcrElement,
  prefix: string,
  yOffset: number,
): OcrElement {
  return {
    ...element,
    id: prefix + element.id,
    frame: {
      ...element.frame,
      y: element.frame.y + yOffset,
    },
  };
}
