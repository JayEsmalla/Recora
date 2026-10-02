import { Directory, File, Paths } from 'expo-file-system';

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
): Promise<PreparedReceiptImage> {
  const { receipts } = ensureDirectories();
  const sourceFile = new File(image.uri);
  const destination = new File(receipts, `${receiptId}.jpg`);

  await sourceFile.copy(destination, { overwrite: false });

  return {
    ...image,
    uri: destination.uri,
    fileSize: destination.size || image.fileSize,
  };
}

export function removePrivateReceiptImage(uri: string): void {
  const file = new File(uri);
  if (file.exists) {
    file.delete();
  }
}

export function clearStagedReceiptImages(): void {
  const { staging } = ensureDirectories();
  for (const entry of staging.list()) {
    entry.delete();
  }
}

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
