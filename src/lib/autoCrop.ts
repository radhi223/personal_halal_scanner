import type { TextRecognitionResult } from '@react-native-ml-kit/text-recognition';

import { isCropBoundary, isIngredientHeader, isSectionBoundary } from './normalize';

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** Scale a rect measured on a downscaled image back to original coordinates. */
export function scaleRect(rect: CropRect, factor: number): CropRect {
  return {
    originX: Math.round(rect.originX * factor),
    originY: Math.round(rect.originY * factor),
    width: Math.round(rect.width * factor),
    height: Math.round(rect.height * factor),
  };
}

/** Clamp a rect to the image bounds. */
export function clampRect(rect: CropRect, imageWidth: number, imageHeight: number): CropRect {
  const originX = Math.max(0, Math.min(rect.originX, imageWidth - 1));
  const originY = Math.max(0, Math.min(rect.originY, imageHeight - 1));
  return {
    originX,
    originY,
    width: Math.max(1, Math.min(rect.width, imageWidth - originX)),
    height: Math.max(1, Math.min(rect.height, imageHeight - originY)),
  };
}

export interface CropResult {
  rect: CropRect;
  /** Diagnostics for tuning: what the header matched and what stopped the crop. */
  headerText: string;
  boundaryText: string;
  lines: number;
}

/** List separators; mirrors LIST_SEPARATOR in src/lib/normalize.ts. */
const LIST_SEPARATOR = /[、，,・/／]/;

/** Metadata stop for upward absorption; SECTION_STOP + 種類別 (ABSORB_STOP). */
function isAbsorbStop(text: string): boolean {
  return isSectionBoundary(text) || /種類別/.test(text);
}

/**
 * How many trailing lines of `pieces` (reading order) belong to the ingredient
 * list that WRAPPED BEFORE its 原材料名 marker. Mirrors absorbLeadingPrefix()
 * in src/lib/normalize.ts: walk backwards, keep list-separator lines, once
 * anchored also keep separator-free wrapped fragments, and stop at metadata
 * (名称/品名/種類別/栄養成分/…). Index flavour of the same rule: the crop needs
 * the pixel top of the first absorbed line, while normalize owns the text side.
 */
function absorbedLineCount(pieces: string[]): number {
  let keepFrom = pieces.length;
  let anchored = false;
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i];
    if (!piece) continue;
    if (isAbsorbStop(piece)) break;
    if (LIST_SEPARATOR.test(piece)) {
      anchored = true;
      keepFrom = i;
      continue;
    }
    if (anchored) {
      keepFrom = i;
      continue;
    }
    let prev = i - 1;
    while (prev >= 0 && !pieces[prev]) prev--;
    if (prev >= 0 && !isAbsorbStop(pieces[prev]) && LIST_SEPARATOR.test(pieces[prev])) {
      keepFrom = i;
      continue;
    }
    break;
  }
  return pieces.length - keepFrom;
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
 * Upward boundary: OCR reads two-column panels in an order where the list
 * WRAPS BEFORE its marker (e.g. 小麦粉、…、食塩/加工デ then 原材料名 …). The
 * crop therefore starts at the first preceding list-like line, using the same
 * backwards absorption as extractIngredientSection: absorb while lines contain
 * 、，,・/ (once one is seen, separator-free wrapped fragments are absorbed
 * too) and stop at metadata (名称/品名/種類別/栄養成分/…). Product-name and
 * 種類別 lines are never swallowed. The downward boundary logic is unchanged.
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

  // Recover list lines that wrapped before the marker: grow the crop upward
  // to the first absorbed line so they are not cut away before the OCR pass.
  const absorbed = absorbedLineCount(lines.slice(0, startIdx).map((l) => l.text));
  const firstIdx = startIdx - absorbed;
  const startTop = lines[firstIdx].frame!.top;
  let bottom = lines[startIdx].frame!.top + lines[startIdx].frame!.height;
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
    // Upward growth can push originY toward the top edge; clampRect keeps the
    // final rect inside the image on every side.
    rect: clampRect(
      {
        originX: Math.round(originX),
        originY: Math.round(originY),
        width: Math.round(width),
        height: Math.round(height),
      },
      imageWidth,
      imageHeight
    ),
    headerText: lines[startIdx].text,
    boundaryText,
    lines: collected + 1 + absorbed,
  };
}
