import { Directory, File, Paths } from 'expo-file-system';

import { selectOrphanedReceiptImageUris } from './imageCleanup';
import type { PreparedReceiptImage, ReceiptImageSource } from './types';

const ROOT_DIRECTORY = 'recora';
const RECEIPT_DIRECTORY = 'receipts';
const STAGING_DIRECTORY = 'staging';

function ensureDirectories(): {
  receipts: Directory;
  staging: Directory;
} {
  const root = new Directory(Paths.document, ROOT_DIRECTORY);
  root.create({ idempotent: true, intermediates: true });

  const receipts = new Directory(root, RECEIPT_DIRECTORY);
  receipts.create({ idempotent: true, intermediates: true });

  const staging = new Directory(root, STAGING_DIRECTORY);
  staging.create({ idempotent: true, intermediates: true });

  return { receipts, staging };
}

export async function stageReceiptImage(
  source: ReceiptImageSource,
): Promise<ReceiptImageSource> {
  const { staging } = ensureDirectories();
  const sourceFile = new File(source.uri);
  const destination = new File(staging, `${createLocalId('capture')}.jpg`);

  await sourceFile.copy(destination, { overwrite: false });

  return {
    ...source,
    uri: destination.uri,
    fileSize: destination.size || source.fileSize,
  };
}

export async function retainPreparedReceiptImage(
  image: PreparedReceiptImage,
  receiptId: string,
  pagePosition = 0,
): Promise<PreparedReceiptImage> {
  const { receipts } = ensureDirectories();
  const sourceFile = new File(image.uri);
  const destination = new File(
    receipts,
    `${receiptId}-page-${pagePosition}.jpg`,
  );

  await sourceFile.copy(destination, { overwrite: false });

  return {
    ...image,
    uri: destination.uri,
    fileSize: destination.size || image.fileSize,
  };
}

export function removePrivateReceiptImage(uri: string): boolean {
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
    return true;
  } catch {
    // SQLite is the source of truth. A failed best-effort file cleanup must not
    // roll back or misreport an already committed receipt state. Startup orphan
    // pruning will retry files that are no longer referenced by the database.
    return false;
  }
}

export function clearStagedReceiptImages(): void {
  const { staging } = ensureDirectories();
  for (const entry of staging.list()) {
    entry.delete();
  }
}

export function pruneOrphanedReceiptImages(
  referencedUris: readonly string[],
): string[] {
  const { receipts } = ensureDirectories();
  const entries = receipts.list();
  const orphaned = new Set(
    selectOrphanedReceiptImageUris(
      entries.map((entry) => entry.uri),
      referencedUris,
    ),
  );
  const removed: string[] = [];

  for (const entry of entries) {
    if (!orphaned.has(entry.uri)) {
      continue;
    }

    removed.push(entry.uri);
    entry.delete();
  }

  return removed;
}

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
