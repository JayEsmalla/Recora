import MlkitOcr from 'rn-mlkit-ocr';

import { normalizeMlKitResult } from './normalizeOcrResult';
import type { OcrDocument, OcrEngine, OcrInput } from './types';

const ENGINE_ID = 'mlkit-latin-bundled';

export class MlKitOcrEngine implements OcrEngine {
  readonly id = ENGINE_ID;

  async recognize(
    input: OcrInput,
    signal?: AbortSignal,
  ): Promise<OcrDocument> {
    throwIfAborted(signal);

    const languages = await MlkitOcr.getAvailableLanguages();
    throwIfAborted(signal);

    if (!languages.includes('latin')) {
      throw new Error(
        'The bundled Latin OCR model is unavailable in this build.',
      );
    }

    const result = await MlkitOcr.recognizeText(input.uri, 'latin');
    throwIfAborted(signal);

    return normalizeMlKitResult(
      result,
      input.width,
      input.height,
      this.id,
    );
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  const error = new Error('OCR processing was cancelled.');
  error.name = 'AbortError';
  return error;
}
