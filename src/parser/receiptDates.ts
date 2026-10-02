import type { OcrLine } from '../ocr/types';
import type { ParsedDateCandidate } from './types';

const NUMERIC_DATE =
  /\b(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})(?:\s+([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?)?\b/;

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const NAMED_DATE =
  /\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})(?:\s+([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?)?\b/i;

export function findDateCandidate(lines: readonly OcrLine[]): ParsedDateCandidate | null {
  const candidates = lines
    .map((line) => ({
      line,
      parsed: parseDateText(line.text),
      labeled: /\b(?:DATE|TRANS(?:ACTION)?\s*DATE)\b/i.test(line.text),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        line: OcrLine;
        parsed: Omit<ParsedDateCandidate, 'observationIds'>;
        labeled: boolean;
      } => candidate.parsed !== null,
    )
    .sort((left, right) => {
      if (left.labeled !== right.labeled) {
        return left.labeled ? -1 : 1;
      }
      return left.line.frame.y - right.line.frame.y;
    });

  const best = candidates[0];
  if (!best) {
    return null;
  }

  return {
    ...best.parsed,
    observationIds: [best.line.id],
  };
}

export function parseDateText(
  text: string,
): Omit<ParsedDateCandidate, 'observationIds'> | null {
  const numeric = text.match(NUMERIC_DATE);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const third = Number(numeric[3]);

    let year: number;
    let month: number;
    let day: number;
    let ambiguous = false;

    if ((numeric[1]?.length ?? 0) === 4) {
      year = first;
      month = second;
      day = third;
    } else {
      year = normalizeYear(third);

      if (first > 12 && second <= 12) {
        day = first;
        month = second;
      } else if (second > 12 && first <= 12) {
        month = first;
        day = second;
      } else {
        month = first;
        day = second;
        ambiguous = first !== second;
      }
    }

    if (!isPlausibleDate(year, month, day)) {
      return {
        raw: numeric[0],
        isoDateTime: null,
        ambiguous: true,
      };
    }

    return {
      raw: numeric[0],
      isoDateTime: ambiguous
        ? null
        : toIsoLocal(
            year,
            month,
            day,
            numeric[4],
            numeric[5],
            numeric[6],
          ),
      ambiguous,
      alternativeIsoDateTimes: ambiguous
        ? numericDateAlternatives(
            year,
            first,
            second,
            numeric[4],
            numeric[5],
            numeric[6],
          )
        : undefined,
    };
  }

  const named = text.match(NAMED_DATE);
  if (named) {
    const month = MONTH_NAMES[named[1]?.toLowerCase() ?? ''];
    const day = Number(named[2]);
    const year = Number(named[3]);

    if (!month || !isPlausibleDate(year, month, day)) {
      return {
        raw: named[0],
        isoDateTime: null,
        ambiguous: true,
      };
    }

    return {
      raw: named[0],
      isoDateTime: toIsoLocal(
        year,
        month,
        day,
        named[4],
        named[5],
        named[6],
      ),
      ambiguous: false,
    };
  }

  return null;
}

function numericDateAlternatives(
  year: number,
  first: number,
  second: number,
  hour?: string,
  minute?: string,
  secondValue?: string,
): string[] {
  const candidates: string[] = [];

  if (isPlausibleDate(year, first, second)) {
    candidates.push(
      toIsoLocal(year, first, second, hour, minute, secondValue),
    );
  }

  if (
    first !== second &&
    isPlausibleDate(year, second, first)
  ) {
    candidates.push(
      toIsoLocal(year, second, first, hour, minute, secondValue),
    );
  }

  return [...new Set(candidates)];
}

function normalizeYear(year: number): number {
  if (year >= 100) {
    return year;
  }
  return year >= 70 ? 1900 + year : 2000 + year;
}

function isPlausibleDate(year: number, month: number, day: number): boolean {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= maxDay;
}

function toIsoLocal(
  year: number,
  month: number,
  day: number,
  hour?: string,
  minute?: string,
  second?: string,
): string {
  const date = [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');

  if (hour === undefined || minute === undefined) {
    return date;
  }

  return `${date}T${String(Number(hour)).padStart(2, '0')}:${String(
    Number(minute),
  ).padStart(2, '0')}:${String(Number(second ?? '0')).padStart(2, '0')}`;
}
