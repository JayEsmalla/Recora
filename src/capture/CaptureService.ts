import * as ImagePicker from 'expo-image-picker';

import {
  removePrivateReceiptImage,
  stageReceiptImage,
} from './ReceiptImageStore';
import type { ReceiptImageSource } from './types';

export const MAX_RECEIPT_PHOTOS = 5;

export type CaptureResult =
  | { status: 'captured'; images: ReceiptImageSource[] }
  | { status: 'cancelled' }
  | { status: 'permission-denied'; source: 'camera' | 'library' };

export async function captureReceiptWithCamera(): Promise<CaptureResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { status: 'permission-denied', source: 'camera' };
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
    exif: false,
  });

  return stagePickerResult(result, 'camera');
}

export async function importReceiptFromLibrary(
  maxPhotos = MAX_RECEIPT_PHOTOS,
): Promise<CaptureResult> {
  const selectionLimit = Math.max(
    1,
    Math.min(MAX_RECEIPT_PHOTOS, Math.trunc(maxPhotos)),
  );
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit,
    orderedSelection: true,
    allowsEditing: false,
    quality: 1,
    exif: false,
  });

  return stagePickerResult(result, 'library');
}

export async function recoverPendingImagePickerResult(): Promise<CaptureResult | null> {
  const result = await ImagePicker.getPendingResultAsync();
  if (!result || 'code' in result) {
    return null;
  }

  return stagePickerResult(result, 'recovered');
}

async function stagePickerResult(
  result: ImagePicker.ImagePickerResult,
  origin: ReceiptImageSource['origin'],
): Promise<CaptureResult> {
  if (result.canceled || !result.assets?.length) {
    return { status: 'cancelled' };
  }

  if (result.assets.length > MAX_RECEIPT_PHOTOS) {
    throw new Error(
      `Select at most ${MAX_RECEIPT_PHOTOS} photos for one receipt.`,
    );
  }

  const staged: ReceiptImageSource[] = [];

  try {
    for (const asset of result.assets) {
      if (asset.width <= 0 || asset.height <= 0) {
        throw new Error('A selected image did not report valid dimensions.');
      }

      staged.push(
        await stageReceiptImage({
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
          fileSize: asset.fileSize ?? null,
          origin,
        }),
      );
    }

    return {
      status: 'captured',
      images: staged,
    };
  } catch (error) {
    for (const image of staged) {
      removePrivateReceiptImage(image.uri);
    }
    throw error;
  }
}
