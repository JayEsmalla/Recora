/**
 * Privacy-preserving, ephemeral diagnostics. Never store raw exceptions,
 * receipt content, identifiers, image paths, OCR text, or stack traces.
 * Events are local-only and are not sent to any network endpoint.
 */
export type DiagnosticArea =
  | 'startup' | 'capture' | 'cleanup' | 'ocr'
  | 'review' | 'history' | 'maintenance';

export type FailureCode =
  | 'cancelled' | 'permission-denied' | 'storage-full'
  | 'database-busy' | 'database-integrity'
  | 'ocr-unavailable' | 'unexpected';

export interface DiagnosticEvent {
  area: DiagnosticArea;
  code: FailureCode;
  occurredAt: number;
}

const MAX_EVENTS = 50;
const events: DiagnosticEvent[] = [];

export function classifyLocalFailure(error: unknown): FailureCode {
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  const message = error instanceof Error ? error.message : '';
  if (/EACCES|EPERM|permission denied|not authorized/i.test(message)) {
    return 'permission-denied';
  }
  if (/SQLITE_FULL|ENOSPC|no space left|database or disk is full/i.test(message)) {
    return 'storage-full';
  }
  if (/SQLITE_BUSY|SQLITE_LOCKED|database is locked|database is busy/i.test(message)) {
    return 'database-busy';
  }
  if (/SQLITE_CORRUPT|database disk image is malformed|foreign key constraint failed/i.test(message)) {
    return 'database-integrity';
  }
  if (/bundled Latin OCR model is unavailable|ML Kit.*unavailable/i.test(message)) {
    return 'ocr-unavailable';
  }
  return 'unexpected';
}

export function recordLocalFailure(
  area: DiagnosticArea,
  error: unknown,
): FailureCode {
  const code = classifyLocalFailure(error);
  events.push({ area, code, occurredAt: Date.now() });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  return code;
}

export function getLocalDiagnosticSummary(): Record<FailureCode, number> {
  const counts: Record<FailureCode, number> = {
    cancelled: 0,
    'permission-denied': 0,
    'storage-full': 0,
    'database-busy': 0,
    'database-integrity': 0,
    'ocr-unavailable': 0,
    unexpected: 0,
  };
  for (const event of events) counts[event.code] += 1;
  return counts;
}

export function clearLocalDiagnostics(): void {
  events.splice(0, events.length);
}
