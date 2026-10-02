export interface OcrFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrPoint {
  x: number;
  y: number;
}

export interface OcrElement {
  id: string;
  text: string;
  frame: OcrFrame;
  confidence: number | null;
}

export interface OcrLine {
  id: string;
  text: string;
  frame: OcrFrame;
  confidence: number | null;
  elements: OcrElement[];
}

export interface OcrBlock {
  id: string;
  text: string;
  frame: OcrFrame;
  confidence: number | null;
  lines: OcrLine[];
}

export interface OcrDocument {
  engine: string;
  imageWidth: number;
  imageHeight: number;
  rawText: string;
  blocks: OcrBlock[];
}

export interface OcrInput {
  uri: string;
  width: number;
  height: number;
}

export interface OcrEngine {
  readonly id: string;
  recognize(input: OcrInput, signal?: AbortSignal): Promise<OcrDocument>;
}
