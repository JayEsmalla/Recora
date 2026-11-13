export const HISTORY_PAGE_SIZE = 10;

export interface HistoryPage<T> {
  entries: T[];
  page: number;
  pageCount: number;
  start: number;
  end: number;
  total: number;
}

export function paginateHistory<T>(
  entries: readonly T[],
  requestedPage: number,
  pageSize = HISTORY_PAGE_SIZE,
): HistoryPage<T> {
  const size = Number.isFinite(pageSize) && pageSize > 0
    ? Math.floor(pageSize)
    : HISTORY_PAGE_SIZE;
  const total = entries.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const requested = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1;
  const page = Math.max(1, Math.min(pageCount, requested));
  const firstIndex = (page - 1) * size;

  return {
    entries: entries.slice(firstIndex, firstIndex + size),
    page,
    pageCount,
    start: total === 0 ? 0 : firstIndex + 1,
    end: Math.min(total, firstIndex + size),
    total,
  };
}
