import { File } from 'expo-file-system';
import { PaddleOcrService, V5_MOBILE_MODEL } from 'ppu-paddle-ocr/mobile';

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
    service = new PaddleOcrService({ model: V5_MOBILE_MODEL });
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

/** On-device Japanese OCR via PaddleOCR. Throws if native module unavailable. */
export async function recognizeJapanesePaddle(imageUri: string): Promise<string> {
  if (!PADDLE_OCR_ENABLED) return '';
  const t0 = Date.now();
  const svc = await getService();
  console.log(`[Paddle] init ready in ${Date.now() - t0}ms`);

  const buffer = await new File(imageUri).arrayBuffer();
  console.log(`[Paddle] image bytes=${buffer.byteLength}`);

  const t1 = Date.now();
  // cross-line batches crops into uniform-width groups -> fewest inferences.
  const result = await svc.recognize(buffer, {
    flatten: true,
    minimumConfidence: 0.4,
    strategy: 'cross-line',
  });
  const text = result.text ?? '';
  console.log(`[Paddle] recognize ${Date.now() - t1}ms chars=${text.length}`);
  console.log(`[Paddle] text=${text.slice(0, 300)}`);
  return text;
}
