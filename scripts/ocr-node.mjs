/**
 * Offline Node OCR CLI — runs the app's REAL PaddleOCR model preset on an image
 * file, no phone involved.
 *
 * Node entry of `ppu-paddle-ocr` (root export) -> onnxruntime-node + @napi-rs/canvas.
 * Uses the SAME preset as src/lib/ocrPaddle.ts (V5_MOBILE_MODEL) and the same
 * recognize options (flatten, minimumConfidence 0.4, per-line strategy) so the
 * text is comparable to on-device output.
 *
 * Models are downloaded from HuggingFace on first run and cached under
 *   %USERPROFILE%\.cache\ppu-paddle-ocr\<sha256-prefix>\
 * After that it runs offline.
 *
 * Usage:
 *   node scripts/ocr-node.mjs <image.jpg> [--json]
 *
 * Exit codes: 0 ok, 1 bad usage / OCR failure.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PaddleOcrService, V5_MOBILE_MODEL } from 'ppu-paddle-ocr';

// Same values as the library's processor/model-cache.js (not importable through
// the package's export map).
const CACHE_DIR = path.join(os.homedir(), '.cache', 'ppu-paddle-ocr');

function cacheStats() {
  try {
    const files = [];
    for (const d of readdirSync(CACHE_DIR)) {
      const dir = path.join(CACHE_DIR, d);
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        files.push({ file: f, bytes: statSync(p).size });
      }
    }
    return files;
  } catch {
    return [];
  }
}

function usage() {
  console.error('usage: node scripts/ocr-node.mjs <image.jpg> [--json]');
}

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const imageArg = argv.find((a) => !a.startsWith('--'));

if (!imageArg) {
  usage();
  process.exit(1);
}

const imagePath = path.resolve(imageArg);
if (!existsSync(imagePath)) {
  console.error(`image not found: ${imagePath}`);
  usage();
  process.exit(1);
}

let service;
try {
  const t0 = Date.now();
  service = new PaddleOcrService({ model: V5_MOBILE_MODEL });
  await service.initialize();
  const initMs = Date.now() - t0;

  const buf = readFileSync(imagePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  const t1 = Date.now();
  const result = await service.recognize(arrayBuffer, {
    flatten: true,
    minimumConfidence: 0.4,
    strategy: 'per-line',
  });
  const ocrMs = Date.now() - t1;

  const text = result.text ?? '';
  const lines = (result.results ?? []).map((r) => ({
    text: r.text,
    confidence: r.confidence,
    box: r.box,
  }));

  const out = {
    image: imagePath,
    model: 'V5_MOBILE_MODEL',
    initMs,
    ocrMs,
    chars: text.length,
    confidence: result.confidence ?? null,
    text,
    lines,
    cacheDir: CACHE_DIR,
    cacheFiles: cacheStats(),
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`image : ${imagePath}`);
    console.log(`model : V5_MOBILE_MODEL (init ${initMs}ms, cached at ${CACHE_DIR})`);
    console.log(`ocr   : ${ocrMs}ms   chars: ${text.length}   mean score: ${result.confidence?.toFixed(4) ?? 'n/a'}`);
    console.log('--- text ---');
    console.log(text);
    if (lines.length) {
      console.log('--- lines (score) ---');
      for (const l of lines) console.log(`  (${l.confidence?.toFixed(3) ?? '?'}) ${l.text}`);
    }
  }

  await service.destroy();
  process.exit(0);
} catch (err) {
  console.error('OCR failed:', err?.stack ?? String(err));
  console.error(`model cache dir: ${CACHE_DIR}`);
  console.error('first run needs network access to https://huggingface.co/snowfluke/ppu-paddle-ocr-models');
  process.exit(1);
}
