import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { CropRect } from './autoCrop';

/** Upper bound for OCR input width (models resize to a fixed input regardless). */
const MAX_OCR_WIDTH = 2000;

export interface PreparedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Crop to the ingredient region and upscale it, so small kanji become large
 * enough for the OCR models. Upscaling is cheap and lossless-ish for OCR
 * purposes (models resize to a fixed height anyway; more source pixels help).
 */
export async function cropAndUpscale(
  uri: string,
  rect: CropRect,
  scale = 2
): Promise<PreparedImage> {
  const context = ImageManipulator.manipulate(uri);
  context.crop({
    originX: rect.originX,
    originY: rect.originY,
    width: rect.width,
    height: rect.height,
  });
  // Cap the upscale: the OCR models downscale to a fixed input size anyway, so
  // pushing past ~2000px only adds memory/time and can make text effectively
  // smaller. Only resize when it actually increases resolution.
  const target = Math.min(Math.round(rect.width * scale), MAX_OCR_WIDTH);
  if (target > rect.width) {
    context.resize({ width: target });
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: 0.95, format: SaveFormat.JPEG });
  return { uri: result.uri, width: result.width, height: result.height };
}
