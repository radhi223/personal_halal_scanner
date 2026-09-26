import type { TextRecognitionResult } from '@react-native-ml-kit/text-recognition';

import { isCropBoundary, isIngredientHeader } from './normalize';

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface CropResult {
  rect: CropRect;
  /** Diagnostics for tuning: what the header matched and what stopped the crop. */
  headerText: string;
  boundaryText: string;
  lines: number;
}

/**
 * Phase 1 accuracy lever: find the pixel region of the 原材料名 list from ML Kit's
 * line frames, so we can crop to it and upscale before OCR.
 *
 * Why this helps: OCR errors on Japanese labels come mostly from *small* text
 * and from unrelated text (prices, dates, nutrition, addresses) confusing the
 * matcher. Cropping to the ingredient block and scaling it 2x attacks both at
 * the source, instead of patching patterns after the fact.
 *
 * Returns null when the header can't be located (caller then uses the full image).
 */
export function computeIngredientCrop(
  result: TextRecognitionResult,
  imageWidth: number,
  imageHeight: number
): CropResult | null {
  const lines = [];
  for (const block of result.blocks ?? []) {
    for (const line of block.lines ?? []) {
      if (line.frame) lines.push(line);
    }
  }
  if (!lines.length) return null;

  // Reading order: top to bottom.
  lines.sort((a, b) => (a.frame!.top ?? 0) - (b.frame!.top ?? 0));

  const startIdx = lines.findIndex((l) => isIngredientHeader(l.text));
  if (startIdx === -1) return null;

  const startTop = lines[startIdx].frame!.top;
  let bottom = startTop + lines[startIdx].frame!.height;
  let collected = 0;
  let boundaryText = '';

  for (let i = startIdx + 1; i < lines.length; i++) {
    const frame = lines[i].frame!;
    if (isCropBoundary(lines[i].text)) {
      boundaryText = lines[i].text;
      break;
    }
    bottom = frame.top + frame.height;
    collected++;
    if (collected > 25) break; // safety: don't swallow the whole label
  }

  if (bottom <= startTop) return null;

  const marginX = Math.round(imageWidth * 0.03);
  const marginY = Math.round(imageHeight * 0.012);
  const originX = Math.max(0, marginX);
  const originY = Math.max(0, startTop - marginY);
  const width = Math.min(imageWidth - originX, imageWidth - marginX * 2);
  const height = Math.min(imageHeight - originY, bottom - startTop + marginY * 2);

  if (width < 80 || height < 24) return null;
  return {
    rect: {
      originX: Math.round(originX),
      originY: Math.round(originY),
      width: Math.round(width),
      height: Math.round(height),
    },
    headerText: lines[startIdx].text,
    boundaryText,
    lines: collected + 1,
  };
}
