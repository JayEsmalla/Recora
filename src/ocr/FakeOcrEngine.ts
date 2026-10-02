import type { OcrDocument, OcrEngine, OcrInput } from './types';

export class FakeOcrEngine implements OcrEngine {
  readonly id = 'fixture';

  constructor(
    private readonly document:
      | OcrDocument
      | ((input: OcrInput) => OcrDocument),
  ) {}

  async recognize(
    input: OcrInput,
    signal?: AbortSignal,
  ): Promise<OcrDocument> {
    if (signal?.aborted) {
      const error = new Error('OCR processing was cancelled.');
      error.name = 'AbortError';
      throw error;
    }

    const document =
      typeof this.document === 'function'
        ? this.document(input)
        : this.document;

    return {
      ...document,
      imageWidth: input.width,
      imageHeight: input.height,
    };
  }
}
