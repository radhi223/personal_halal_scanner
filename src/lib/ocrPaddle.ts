import { File } from 'expo-file-system';
import { PaddleOcrService, V5_MOBILE_MODEL } from 'ppu-paddle-ocr/mobile';

import {
  mergeOcrTileTexts,
  OCR_STRIP_SCAN_MAX_CHARS,
  planStripTiles,
  tileRects,
} from './autoCrop';
import { cropAndUpscale, getImageSize } from './imagePrep';

/**
 * Second OCR engine: PaddleOCR PP-OCRv5 (multilingual, includes Japanese)
 * running on-device via onnxruntime-react-native + Skia.
 *
 * We deliberately do NOT use the default PP-OCRv6 tiny preset — its dictionary
 * drops rare CJK/kana, which is exactly what Japanese labels need.
 *
 * First initialize() downloads the model files once and caches them. Until they
 * are bundled offline (Phase 3.3) this needs a network connection on first use.
 */
let service: PaddleOcrService | null = null;
let initPromise: Promise<void> | null = null;

async function getService(): Promise<PaddleOcrService> {
  if (!service) {
    service = new PaddleOcrService({
      model: V5_MOBILE_MODEL,
      // NOTE on `processing.engine`: on React Native this setting is a no-op.
      // `mobile/paddle-ocr.service.mobile.js` (ppu-paddle-ocr 6.6.0) builds its
      // Detection/Recognition services with a hardcoded "canvas-native" engine
      // and never reads `options.processing`; the mobile platform provider
      // wraps `ppu-ocv/canvas-mobile` (Skia) and exposes no OpenCV
      // `imageProcessor`. So the library default `engine: 'opencv'` cannot
      // apply here: every mobile run uses canvas-native. (Verified against the
      // installed 6.6.0 sources, 2026-09-27.)
      session: {
        // Hardware acceleration on Android (GPU/NPU via NNAPI); ONNX Runtime
        // falls back to CPU automatically if a provider is unavailable.
        //
        // NOTE: forcing NNAPI with `cpuDisabled: true` was tested (2026-09-26) and
        // gave only ~3% faster inference while the recognized text looked worse
        // (e.g. カラメル/クエン酸/微粒二酸化ケイ素 misread). Per the accuracy-first
        // rule it was rolled back. Do not re-enable without measuring on the SAME
        // image and proving accuracy is unchanged.
        executionProviders: ['nnapi', 'cpu'],
        // Used when NNAPI isn't available: spread inference across big cores.
        intraOpNumThreads: 4,
        onSessionFallback: (err) => console.warn('[Paddle] session fallback:', String(err)),
      },
    });
    initPromise = service.initialize();
  }
  await initPromise;
  return service;
}

/** True once models are loaded and the service can recognize. */
export function isPaddleReady(): boolean {
  return !!service && service.isInitialized();
}

/**
 * Load models ahead of time (call on app start) so the first scan does not pay
 * the initialization cost.
 */
export async function warmUpPaddle(): Promise<void> {
  if (!PADDLE_OCR_ENABLED) return;
  try {
    await getService();
    console.log('[Paddle] warm-up done');
  } catch (err) {
    console.warn('[Paddle] warm-up failed:', String(err));
  }
}

/**
 * Kill switch. PaddleOCR/ORT caused a native force-close during scanning on a
 * real device; a native crash cannot be caught in JS, so we gate it until we
 * can read logcat and fix the root cause. ML Kit keeps working.
 */
export const PADDLE_OCR_ENABLED = true;

/**
 * One recognition pass. per-line is the accuracy-first choice. The library's
 * own benchmark (opencv engine, v6 tiny, same reference receipt) reports
 * per-box/per-line 99.48% vs cross-line 94.26% recognition accuracy. We
 * previously forced cross-line because it batches crops into uniform-width
 * groups -> fewest inferences, but that was a speed-over-accuracy trade
 * costing ~5 points. Accuracy wins.
 */
async function recognizeOnce(svc: PaddleOcrService, buffer: ArrayBuffer): Promise<string> {
  const result = await svc.recognize(buffer, {
    flatten: true,
    minimumConfidence: 0.4,
    strategy: 'per-line',
  });
  return result.text ?? '';
}

/** On-device Japanese OCR via PaddleOCR. Throws if native module unavailable. */
export async function recognizeJapanesePaddle(imageUri: string): Promise<string> {
  if (!PADDLE_OCR_ENABLED) return '';
  const t0 = Date.now();
  const svc = await getService();
  console.log(`[Paddle] init ready in ${Date.now() - t0}ms`);

  const buffer = await new File(imageUri).arrayBuffer();
  console.log(`[Paddle] image bytes=${buffer.byteLength}`);

  const t1 = Date.now();
  let text = await recognizeOnce(svc, buffer);
  console.log(`[Paddle] recognize ${Date.now() - t1}ms chars=${text.length}`);

  // Strip recovery: a single pass over a wide/thin strip can return almost
  // nothing because the detector scales its whole input down from the longest
  // side. Re-read the strip as overlapping vertical tiles (same per-line
  // options) and keep the merged text only when it beats the first pass.
  // Gated on a character count that cannot be reached by a sparse strip at the
  // app's <=1600px work width, so ordinary photos never pay for the probe.
  if (text.length < OCR_STRIP_SCAN_MAX_CHARS) {
    try {
      const size = await getImageSize(imageUri);
      const plan = planStripTiles(text.length, size.width, size.height);
      if (plan) {
        const t2 = Date.now();
        const rects = tileRects(size.width, size.height, plan);
        const tileTexts: string[] = [];
        for (const rect of rects) {
          const tile = await cropAndUpscale(imageUri, rect, 1);
          tileTexts.push(await recognizeOnce(svc, await new File(tile.uri).arrayBuffer()));
        }
        const merged = mergeOcrTileTexts(tileTexts);
        const ms = Date.now() - t2;
        if (merged.length > text.length) {
          console.log(
            `[Paddle] strip tiles=${rects.length} ${text.length}->${merged.length} chars in ${ms}ms`
          );
          text = merged;
        } else {
          console.log(
            `[Paddle] strip tiles=${rects.length} kept first pass (${text.length}>=${merged.length}) in ${ms}ms`
          );
        }
      }
    } catch (err) {
      console.warn('[Paddle] strip recovery failed:', String(err));
    }
  }

  console.log(`[Paddle] text=${text.slice(0, 300)}`);
  return text;
}
