export function selectOrphanedReceiptImageUris(
  candidateUris: readonly string[],
  referencedUris: readonly string[],
  protectedUris: readonly string[] = [],
): string[] {
  const referenced = new Set([...referencedUris, ...protectedUris]);
  return candidateUris.filter((uri) => !referenced.has(uri));
}
