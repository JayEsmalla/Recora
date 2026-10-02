export function selectOrphanedReceiptImageUris(
  candidateUris: readonly string[],
  referencedUris: readonly string[],
): string[] {
  const referenced = new Set(referencedUris);
  return candidateUris.filter((uri) => !referenced.has(uri));
}
