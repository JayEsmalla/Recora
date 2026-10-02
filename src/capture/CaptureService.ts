import * as ImagePicker from 'expo-image-picker';

import { stageReceiptImage } from './ReceiptImageStore';
import type { ReceiptImageSource } from './types';

export type CaptureResult =
  | { status: 'captured'; image: ReceiptImageSource }
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

export async function importReceiptFromLibrary(): Promise<CaptureResult> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
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
  if (result.canceled || !result.assets?.[0]) {
    return { status: 'cancelled' };
  }

  const asset = result.assets[0];
  if (asset.width <= 0 || asset.height <= 0) {
    throw new Error('The selected image did not report valid dimensions.');
  }

  return {
    status: 'captured',
    image: await stageReceiptImage({
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize ?? null,
      origin,
    }),
  };
}
