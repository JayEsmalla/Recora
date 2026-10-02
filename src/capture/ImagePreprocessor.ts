import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import {
  computeOcrResize,
  cropCoverage,
  FULL_IMAGE_CROP,
  normalizedCropToPixels,
} from './imageGeometry';
import type {
  NormalizedCrop,
  PreparedReceiptImage,
  ReceiptImageSource,
} from './types';

export interface PrepareReceiptImageOptions {
  crop?: NormalizedCrop;
  maxPixels?: number;
}

export async function rotateReceiptImage(
  source: ReceiptImageSource,
  degrees: 90 | -90,
): Promise<ReceiptImageSource> {
  const result = await manipulateAsync(
    source.uri,
    [{ rotate: degrees }],
    { compress: 0.96, format: SaveFormat.JPEG },
  );

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    fileSize: null,
    origin: source.origin,
  };
}

export async function prepareReceiptImage(
  source: ReceiptImageSource,
  options: PrepareReceiptImageOptions = {},
): Promise<PreparedReceiptImage> {
  const crop = options.crop ?? FULL_IMAGE_CROP;
  const cropPixels = normalizedCropToPixels(crop, source.width, source.height);
  const resize = computeOcrResize(
    cropPixels.width,
    cropPixels.height,
    options.maxPixels,
  );

  const actions: Parameters<typeof manipulateAsync>[1] = [
    { crop: cropPixels },
  ];

  if (resize.width !== cropPixels.width || resize.height !== cropPixels.height) {
    actions.push({ resize });
  }

  const result = await manipulateAsync(source.uri, actions, {
    compress: 0.94,
    format: SaveFormat.JPEG,
  });

  const outputFile = new File(result.uri);

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    fileSize: outputFile.exists ? outputFile.size : null,
    cropCoverage: cropCoverage(crop),
  };
}
