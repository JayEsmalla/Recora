export type MinorUnits = number;

export function assertMinorUnits(value: number): MinorUnits {
  if (!Number.isSafeInteger(value)) {
    throw new Error('Money must be stored as a safe integer in minor units.');
  }
  return value;
}

export function addMinorUnits(values: readonly number[]): MinorUnits {
  return assertMinorUnits(values.reduce((sum, value) => {
    assertMinorUnits(value);
    return sum + value;
  }, 0));
}

export function parseMajorAmountToMinor(input: string): MinorUnits {
  const normalized = input.trim().replace(/\s/g, '');
  const match = normalized.match(/^(-?)(\d+)(?:[.,](\d{1,2}))?$/);
  if (!match) {
    throw new Error(`Invalid monetary amount: ${input}`);
  }

  const [, sign, whole, fraction = ''] = match;
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return assertMinorUnits(sign === '-' ? -minor : minor);
}
