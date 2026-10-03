import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { CropRect } from './autoCrop';

/**
 * Target width for the crop fed to OCR. PaddleOCR's preprocessing scales with
 * input size, and its recognizer resizes to a fixed height anyway — so a
 * 2888px crop only costs time. ~1400px keeps small kanji legible while cutting
 * preprocessing sharply.
 */
const MAX_CROP_WIDTH = 1400;

/**
 * Pixel dimensions of an image, decoded via the same native pipeline used for
 * cropping. Only called on the rare near-zero-OCR path (strip recovery), so the
 * extra decode does not touch normal scans.
 */
export async function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  const image = await ImageManipulator.manipulate(uri).renderAsync();
  return { width: image.width, height: image.height };
}

/**
 * Downscale the full label to a workable width before OCR. Both engines resize
 * to a fixed input size internally, so feeding a 3000px photo just makes them do
 * extra resampling work. Coordinates from this smaller image are scaled back up
 * when we crop from the original.
 */
export async function resizeToMaxWidth(uri: string, maxWidth: number): Promise<PreparedImage> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: maxWidth });
  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: 0.95, format: SaveFormat.JPEG });
  return { uri: result.uri, width: result.width, height: result.height };
}

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
  // Resize to the target width — both up (small crops) and down (huge crops).
  const target = Math.min(Math.round(rect.width * scale), MAX_CROP_WIDTH);
  if (target !== rect.width) {
    context.resize({ width: target });
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: 0.95, format: SaveFormat.JPEG });
  return { uri: result.uri, width: result.width, height: result.height };
}
