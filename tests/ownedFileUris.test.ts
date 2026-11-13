import { describe, expect, it } from 'vitest';
import { isAppOwnedFileUri } from '../src/capture/ownedFileUris';

const docs = 'file:///data/app/documents/recora/';
const cache = 'file:///data/app/cache/';

describe('private receipt file deletion boundary', () => {
  it('allows only Recora document files or application cache files', () => {
    expect(isAppOwnedFileUri(
      'file:///data/app/documents/recora/receipts/r-page-0.jpg',
      docs, cache,
    )).toBe(true);
    expect(isAppOwnedFileUri(
      'file:///data/app/documents/recora/staging/temporary.jpg',
      docs, cache,
    )).toBe(true);
    expect(isAppOwnedFileUri(
      'file:///data/app/cache/manipulated-image.jpg',
      docs, cache,
    )).toBe(true);
  });

  it('rejects private files belonging to another application folder', () => {
    expect(isAppOwnedFileUri('file:///data/app/documents/other.jpg', docs, cache)).toBe(false);
    expect(isAppOwnedFileUri('file:///data/app/cache-evil/a.jpg', docs, cache)).toBe(false);
    expect(isAppOwnedFileUri('content://external/file.jpg', docs, cache)).toBe(false);
    expect(isAppOwnedFileUri('https://example.com/receipt.jpg', docs, cache)).toBe(false);
  });

  it('rejects encoded and plain path traversal', () => {
    for (const uri of [
      'file:///data/app/documents/recora/../sensitive.db',
      'file:///data/app/documents/recora/%2e%2e/sensitive.db',
      'file:///data/app/cache/../../somewhere/credentials',
      'file:///data/app/cache/one%2F..%2F..%2Fcredentials',
      'file:///data/app/cache/receipt.jpg?side-effect=1',
    ]) {
      expect(isAppOwnedFileUri(uri, docs, cache)).toBe(false);
    }
  });
});
