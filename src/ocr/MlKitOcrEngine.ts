import {
  getAvailableLanguages,
  recognizeText,
} from 'rn-mlkit-ocr';

import { normalizeMlKitResult } from './normalizeOcrResult';
import type { OcrDocument, OcrEngine, OcrInput } from './types';

const ENGINE_ID = 'mlkit-latin-bundled';

let latinAvailabilityPromise: Promise<void> | null = null;

export class MlKitOcrEngine implements OcrEngine {
  readonly id = ENGINE_ID;

  async recognize(
    input: OcrInput,
    signal?: AbortSignal,
  ): Promise<OcrDocument> {
    throwIfAborted(signal);

    await ensureBundledLatinModel();
    throwIfAborted(signal);

    const result = await recognizeText(input.uri, 'latin');
    throwIfAborted(signal);

    return normalizeMlKitResult(
      result,
      input.width,
      input.height,
      this.id,
    );
  }
}

async function ensureBundledLatinModel(): Promise<void> {
  if (!latinAvailabilityPromise) {
    latinAvailabilityPromise = getAvailableLanguages()
      .then((languages) => {
        if (!languages.includes('latin')) {
          throw new Error(
            'The bundled Latin OCR model is unavailable in this build.',
          );
        }
      })
      .catch((error) => {
        latinAvailabilityPromise = null;
        throw error;
      });
  }

  return latinAvailabilityPromise;
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
