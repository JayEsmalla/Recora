import type { OcrDocument, OcrElement, OcrLine } from './types';

const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;

export function redactSensitiveOcr(document: OcrDocument): OcrDocument {
  return {
    ...document,
    rawText: redactPaymentCardNumbers(document.rawText),
    blocks: document.blocks.map((block) => ({
      ...block,
      text: redactPaymentCardNumbers(block.text),
      lines: block.lines.map(redactLine),
    })),
  };
}

export function redactPaymentCardNumbers(text: string): string {
  return text.replace(CARD_CANDIDATE, (candidate) => {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !passesLuhn(digits)) {
      return candidate;
    }

    return `[REDACTED CARD **** ${digits.slice(-4)}]`;
  });
}

export function containsPaymentCardNumber(text: string): boolean {
  CARD_CANDIDATE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CARD_CANDIDATE.exec(text))) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) {
      CARD_CANDIDATE.lastIndex = 0;
      return true;
    }
  }

  CARD_CANDIDATE.lastIndex = 0;
  return false;
}

function redactLine(line: OcrLine): OcrLine {
  const containsCard = containsPaymentCardNumber(line.text);

  return {
    ...line,
    text: redactPaymentCardNumbers(line.text),
    elements: line.elements.map((element) =>
      redactElement(element, containsCard),
    ),
  };
}

function redactElement(
  element: OcrElement,
  parentLineContainsCard: boolean,
): OcrElement {
  if (parentLineContainsCard && /\d/.test(element.text)) {
    return {
      ...element,
      text: '[REDACTED]',
    };
  }

  return {
    ...element,
    text: redactPaymentCardNumbers(element.text),
  };
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let doubleNext = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);

    if (doubleNext) {
      value *= 2;
      if (value > 9) {
        value -= 9;
      }
    }

    sum += value;
    doubleNext = !doubleNext;
  }

  return sum % 10 === 0;
}
