function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined ||
      year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function validateHistoryDateRange(
  fromDate?: string | null,
  toDate?: string | null,
): string | null {
  const from = fromDate?.trim() ?? '';
  const to = toDate?.trim() ?? '';
  if (from && !isCalendarDate(from)) {
    return 'Enter a valid start date in YYYY-MM-DD format.';
  }
  if (to && !isCalendarDate(to)) {
    return 'Enter a valid end date in YYYY-MM-DD format.';
  }
  if (from && to && from > to) {
    return 'The end date must be on or after the start date.';
  }
  return null;
}
