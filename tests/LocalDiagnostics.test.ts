import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyLocalFailure,
  clearLocalDiagnostics,
  getLocalDiagnosticSummary,
  recordLocalFailure,
} from '../src/data/LocalDiagnostics';

describe('local privacy-preserving backend diagnostics', () => {
  beforeEach(clearLocalDiagnostics);

  it('classifies recoverable failures without recording error messages', () => {
    expect(classifyLocalFailure(new Error('SQLITE_BUSY: database is locked'))).toBe('database-busy');
    expect(classifyLocalFailure(new Error('SQLITE_FULL: database or disk is full'))).toBe('storage-full');
    expect(classifyLocalFailure(new Error('EACCES: permission denied'))).toBe('permission-denied');
    expect(classifyLocalFailure(new Error('database disk image is malformed'))).toBe('database-integrity');
    const cancelled = new Error('cancel');
    cancelled.name = 'AbortError';
    expect(classifyLocalFailure(cancelled)).toBe('cancelled');
  });

  it('never persists a receipt value or file path from arbitrary errors', () => {
    const secret = 'ACCOUNT 1234-5678-9012-3456 file:///private/receipt.jpg';
    const error = new Error(secret);
    const code = recordLocalFailure('ocr', error);
    expect(code).toBe('unexpected');
    const summary = JSON.stringify(getLocalDiagnosticSummary());
    expect(summary).not.toContain(secret);
    expect(summary).not.toContain('file:///');
    expect(getLocalDiagnosticSummary().unexpected).toBe(1);
  });

  it('keeps error counters bounded to 50 local events', () => {
    for (let index = 0; index < 75; index += 1) {
      recordLocalFailure('startup', new Error('unknown'));
    }
    expect(getLocalDiagnosticSummary().unexpected).toBe(50);
    clearLocalDiagnostics();
    expect(getLocalDiagnosticSummary().unexpected).toBe(0);
  });
});
