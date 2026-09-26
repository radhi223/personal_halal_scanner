/**
 * Verbose scan diagnostics.
 *
 * Everything is emitted to logcat under the `HALALDBG` prefix via console.log,
 * so it can be pulled over USB while developing:
 *
 *   adb logcat -d | findstr HALALDBG
 *
 * Long OCR texts are chunked because logcat truncates very long single lines.
 */
const TAG = 'HALALDBG';
const CHUNK = 1000;

/** Flip to true (and rebuild) when you need per-scan diagnostics in logcat. */
export const DEBUG_VERBOSE = true; // temporary: verifying v1 cleanup, flip to false after

export function dlog(msg: string): void {
  if (!DEBUG_VERBOSE) return;
  console.log(`${TAG} ${msg}`);
}

/** Log a long text in chunks, prefixed by a label. */
export function dblock(label: string, text: string | null | undefined): void {
  const s = text ?? '';
  dlog(`${label} len=${s.length}`);
  if (!s) return;
  for (let i = 0; i < s.length; i += CHUNK) {
    dlog(`${label}[${i}] ${s.slice(i, i + CHUNK)}`);
  }
}

export function dscanId(): string {
  return Date.now().toString(36);
}
