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

export interface ReceiptGeometryPreparationHook {
  id: string;
  prepare(input: {
    source: ReceiptImageSource;
    crop: NormalizedCrop;
  }): Promise<{
    source: ReceiptImageSource;
    crop: NormalizedCrop;
  }>;
}

export interface PrepareReceiptImageOptions {
  crop?: NormalizedCrop;
  maxPixels?: number;
  geometryHook?: ReceiptGeometryPreparationHook;
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
  let workingSource = source;
  let crop = options.crop ?? FULL_IMAGE_CROP;

  if (options.geometryHook) {
    const preparedGeometry = await options.geometryHook.prepare({
      source: workingSource,
      crop,
    });
    workingSource = preparedGeometry.source;
    crop = preparedGeometry.crop;
  }

  const cropPixels = normalizedCropToPixels(
    crop,
    workingSource.width,
    workingSource.height,
  );
  const resize = computeOcrResize(
    cropPixels.width,
    cropPixels.height,
    options.maxPixels,
  );

  const fullImage =
    cropPixels.originX === 0 &&
    cropPixels.originY === 0 &&
    cropPixels.width === workingSource.width &&
    cropPixels.height === workingSource.height;
  const resizeNeeded =
    resize.width !== cropPixels.width || resize.height !== cropPixels.height;

  if (fullImage && !resizeNeeded) {
    const sourceFile = new File(workingSource.uri);
    return {
      uri: workingSource.uri,
      width: workingSource.width,
      height: workingSource.height,
      fileSize:
        workingSource.fileSize ??
        (sourceFile.exists ? sourceFile.size : null),
      cropCoverage: 1,
    };
  }

  const actions: Parameters<typeof manipulateAsync>[1] = [
    { crop: cropPixels },
  ];

  if (resizeNeeded) {
    actions.push({ resize });
  }

  const result = await manipulateAsync(workingSource.uri, actions, {
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
