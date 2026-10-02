import { parseMajorAmountToMinor } from '../domain/money';

export interface AmountToken {
  raw: string;
  minor: number;
  start: number;
  end: number;
}

const MONEY_TOKEN =
  /(?:PHP\s*|₱\s*)?-?\(?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\)?-?|(?:PHP\s*|₱\s*)?-?\(?\d{4,9}(?:\.\d{1,2})?\)?-?/gi;

export function extractAmountTokens(text: string): AmountToken[] {
  const tokens: AmountToken[] = [];
  MONEY_TOKEN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = MONEY_TOKEN.exec(text))) {
    const raw = match[0].trim();
    const minor = parseReceiptAmount(raw);
    if (minor === null) {
      continue;
    }

    tokens.push({
      raw,
      minor,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  MONEY_TOKEN.lastIndex = 0;
  return tokens;
}

export function parseReceiptAmount(input: string): number | null {
  let text = input.trim();
  if (!text) {
    return null;
  }

  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith('-')) {
    negative = true;
    text = text.slice(0, -1);
  }

  text = text
    .replace(/^PHP\s*/i, '')
    .replace(/^₱\s*/, '')
    .replace(/,/g, '')
    .trim();

  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    return null;
  }

  try {
    const minor = parseMajorAmountToMinor(text);
    return negative ? -Math.abs(minor) : minor;
  } catch {
    return null;
  }
}

export function rightmostAmount(text: string): AmountToken | null {
  const tokens = extractAmountTokens(text);
  return tokens.length > 0 ? tokens[tokens.length - 1] ?? null : null;
}
