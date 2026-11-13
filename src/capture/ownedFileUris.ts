/**
 * Files may only be removed from Recora's private document directory or the
 * application's private cache. Never accept arbitrary file/content paths.
 * The caller supplies the native filesystem roots so this stays testable.
 */
export function isAppOwnedFileUri(
  uri: string,
  privateDocumentRootUri: string,
  privateCacheRootUri: string,
): boolean {
  try {
    if (!uri.startsWith('file://') || /[?#\\]/.test(uri)) return false;
    const decoded = decodeURIComponent(uri);
    const roots = [privateDocumentRootUri, privateCacheRootUri]
      .map((root) => decodeURIComponent(root))
      .map((root) => root.endsWith('/') ? root : root + '/');

    return roots.some((root) => {
      if (!decoded.startsWith(root)) return false;
      const relative = decoded.slice(root.length);
      if (!relative || /[?#\\]/.test(relative)) return false;
      return relative.split('/').every((segment) =>
        segment !== '' && segment !== '.' && segment !== '..' &&
        !segment.includes('\0'),
      );
    });
  } catch {
    return false;
  }
}
