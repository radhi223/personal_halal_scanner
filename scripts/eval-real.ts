/**
 * Offline end-to-end evaluation harness on IMAGE FILES (no phone).
 *
 * Pipeline under test (the REAL one):
 *   PaddleOCR (V5_MOBILE_MODEL, Node entry) -> strip-tile recovery
 *     -> extractIngredientSection()
 *     -> analyzeLayered(getCuratedIndex(), getCatalogIndex(), section)
 *
 * FIX-B: the first OCR pass is followed by the app's strip recovery
 * (src/lib/autoCrop.ts helpers, same trigger/tiles/keep-if-longer as
 * src/lib/ocrPaddle.ts): wide/thin photos whose first pass yields fewer than
 * max(20, width*0.07) chars are re-read as overlapping 800px tiles and the
 * merged text replaces the first pass only when it is longer. Disable for
 * A/B checks with --no-strip-recovery. `stripRecovery` and `rawText` are
 * recorded per image so this is auditable.
 *
 * Run with tsx (not plain node) because this imports the app's TypeScript
 * modules through the `@/*` tsconfig alias, which tsx resolves natively:
 *
 *   npx tsx scripts/eval-real.ts --dir D:/opencode/temp/labels --out D:/opencode/temp/eval-real.json
 *   npx tsx scripts/eval-real.ts --dir D:/opencode/temp/labels --kind label --out D:/opencode/temp/eval-real-label.json
 *
 * REVISION NOTES (session 5, first label-only baseline):
 *
 *   1. RECURSIVE SCAN. `--dir` is now walked depth-first, so the corpus layout
 *      (`caa/ commons/ off/ personal/ _work/`) can be passed directly. Before
 *      this revision the harness listed only the top level, so a hand-flattened
 *      copy of the labels folder was required. Reported file keys are relative
 *      to `--dir` with forward slashes (`caa/caa_guide_p14.png`), matching
 *      `manifest.json`'s `file` field.
 *
 *   2. PER-IMAGE `kind` CLASSIFICATION (explicit, deterministic,
 *      manifest-overridable). Three kinds:
 *
 *        guide   = government / legal explanatory pages, not product labels.
 *                  Rule: source folder `caa/` or `tokyo/` (manifest sources
 *                  消費者庁 / 東京都保健医療局), or any file name containing
 *                  "guide". Covers `caa_*`, `tokyo_*`, `*_guide*`.
 *        label   = a product ingredient panel. Rule: label-source family
 *                  (off / commons / fldb / labelingjp) AND the base file name
 *                  contains an ingredients/label/back marker:
 *                  "ingredient", "label", "back", "裏", "_ura", "ura_".
 *                  This yields OFF `*_ingredients`, fldb `*_label`, and all
 *                  `labelingjp_*` (the name contains "label").
 *        unknown = everything else (OFF `*_front`, fldb `*_product`, Commons
 *                  product shots / price tags / prints whose file names carry
 *                  no panel marker).
 *
 *      OVERRIDE: if the manifest entry carries a `kind` field with a valid
 *      value (`label` | `guide` | `unknown`), that value wins. The harness also
 *      accepts `--manifest <path>` (default `<dir>/manifest.json`).
 *      `--write-manifest-kind` emits `<manifest dir>/manifest.with-kind.json`
 *      (a NEW file; the original manifest is never modified) containing every
 *      manifest entry plus the resolved `kind` — a drop-in replacement that the
 *      harness will then read directly.
 *
 *   3. `--kind label|guide|all` (default `all`) selects which images are
 *      OCR'd/matched. Per-kind counts are always printed for the whole
 *      classified corpus; per-kind aggregates are reported for the kinds that
 *      were processed. JSON keeps the old `images` + `aggregate` shape and adds
 *      `kindFilter`, `kindCounts`, `sourceCounts`, `byKind`.
 *
 * Missing/empty image folder prints instructions and exits 0.
 */
// @ts-nocheck
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PaddleOcrService, V5_MOBILE_MODEL } from 'ppu-paddle-ocr';

import {
  mergeOcrTileTexts,
  OCR_STRIP_SCAN_MAX_CHARS,
  planStripTiles,
  tileRects,
} from '@/lib/autoCrop';
import { getCatalogIndex, getCuratedIndex } from '@/lib/database';
import { analyzeLayered } from '@/lib/matcher';
import { extractIngredientSection } from '@/lib/normalize';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
const CACHE_DIR = path.join(os.homedir(), '.cache', 'ppu-paddle-ocr');

type Kind = 'label' | 'guide' | 'unknown';
const KINDS: Kind[] = ['label', 'guide', 'unknown'];

function parseArgs(argv: string[]): {
  dir: string;
  out: string;
  kind: Kind | 'all';
  manifest: string | null;
  writeManifestKind: boolean;
  stripRecovery: boolean;
} {
  let dir = 'D:/opencode/temp/labels';
  let out = 'D:/opencode/temp/eval-real.json';
  let kind: Kind | 'all' = 'all';
  let manifest: string | null = null;
  let writeManifestKind = false;
  let stripRecovery = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => argv[++i];
    if (a === '--dir') dir = take() ?? dir;
    else if (a.startsWith('--dir=')) dir = a.slice(6);
    else if (a === '--out') out = take() ?? out;
    else if (a.startsWith('--out=')) out = a.slice(6);
    else if (a === '--kind') kind = (take() ?? kind) as Kind | 'all';
    else if (a.startsWith('--kind=')) kind = a.slice(7) as Kind | 'all';
    else if (a === '--manifest') manifest = take() ?? manifest;
    else if (a.startsWith('--manifest=')) manifest = a.slice(11);
    else if (a === '--write-manifest-kind') writeManifestKind = true;
    else if (a === '--no-strip-recovery') stripRecovery = false;
    else if (a === '--strip-recovery') stripRecovery = true;
  }
  if (kind !== 'all' && !KINDS.includes(kind)) {
    throw new Error(`invalid --kind "${kind}" (expected label | guide | all)`);
  }
  const resolvedDir = path.resolve(dir);
  return {
    dir: resolvedDir,
    out: path.resolve(out),
    kind,
    manifest: manifest ? path.resolve(manifest) : path.join(resolvedDir, 'manifest.json'),
    writeManifestKind,
    stripRecovery,
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function topCounts(map: Map<string, number>, n: number): [string, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

/** Recursively list image files under `root`; keys are relative, `/`-joined. */
function walkImages(root: string): string[] {
  const out: string[] = [];
  const visit = (abs: string): void => {
    let names: string[];
    try {
      names = readdirSync(abs).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(abs, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) visit(full);
      else if (IMAGE_EXT.has(path.extname(name).toLowerCase())) {
        out.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  };
  visit(root);
  return out.sort();
}

/** Load manifest entries keyed by `file` (exact relative path, `/`-normalized). */
function loadManifest(manifestPath: string): Map<string, any> {
  const map = new Map<string, any>();
  if (!manifestPath || !existsSync(manifestPath)) return map;
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.log(`warning: could not parse manifest ${manifestPath}: ${String(err)}`);
    return map;
  }
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.images) ? raw.images : [];
  for (const e of arr) {
    if (e && typeof e.file === 'string') map.set(e.file.replace(/\\/g, '/'), e);
  }
  return map;
}

/** First path segment, with `personal/` split into fldb / labelingjp families. */
function sourceFamily(rel: string): string {
  const top = (rel.split('/')[0] ?? '').toLowerCase();
  if (top === 'personal') {
    const base = path.basename(rel).toLowerCase();
    if (base.startsWith('fldb_')) return 'fldb';
    if (base.startsWith('labelingjp_')) return 'labelingjp';
  }
  return top;
}

const LABEL_NAME_MARKERS = ['ingredient', 'label', 'back', '裏', '_ura', 'ura_'];

/**
 * Explicit kind classifier — see the header block for the full rule set.
 * A valid `kind` on the manifest entry always wins (override hook).
 */
function classifyKind(rel: string, entry?: any): Kind {
  if (entry && KINDS.includes(entry.kind)) return entry.kind as Kind;

  const family = sourceFamily(rel);
  const base = path.basename(rel).toLowerCase();

  // guide: government/legal pages (`caa/`, `tokyo/`) and any `*_guide*`.
  if (family === 'caa' || family === 'tokyo' || base.includes('guide')) return 'guide';

  // label: ingredients/label/back marker in the name of a label-source image.
  const labelSource =
    family === 'off' || family === 'commons' || family === 'fldb' || family === 'labelingjp';
  if (labelSource && LABEL_NAME_MARKERS.some((m) => base.includes(m))) return 'label';

  return 'unknown';
}

function sourceName(rel: string, entry?: any): string {
  if (entry && typeof entry.source === 'string' && entry.source) return entry.source;
  const family = sourceFamily(rel);
  const fallback: Record<string, string> = {
    off: 'Open Food Facts',
    commons: 'Wikimedia Commons',
    caa: '消費者庁 (CAA)',
    tokyo: '東京都保健医療局',
    fldb: 'food-label-db.com (食品表示ラベルナビ)',
    labelingjp: 'labeling.jp (表示ラベルDb)',
  };
  return fallback[family] ?? family;
}

function buildAggregate(imgs: any[], initMs: number): any {
  const unmatchedCounts = new Map<string, number>();
  const unknownCounts = new Map<string, number>();
  const statusTotals: Record<string, number> = { halal: 0, haram: 0, syubhat: 0, unknown: 0 };

  for (const img of imgs) {
    for (const t of img.unmatchedTokens ?? []) {
      unmatchedCounts.set(t, (unmatchedCounts.get(t) ?? 0) + 1);
    }
    for (const t of img.unknownTokens ?? []) {
      unknownCounts.set(t, (unknownCounts.get(t) ?? 0) + 1);
    }
    for (const [status, n] of Object.entries(img.statusTotals ?? {})) {
      statusTotals[status] = (statusTotals[status] ?? 0) + (n as number);
    }
  }

  return {
    images: imgs.length,
    initMs,
    meanOcrMs: mean(imgs.map((i) => i.ocrMs)),
    medianOcrMs: median(imgs.map((i) => i.ocrMs)),
    meanMatched: mean(imgs.map((i) => i.matched)),
    meanUnmatched: mean(imgs.map((i) => i.unmatched)),
    meanUnknown: mean(imgs.map((i) => i.unknown)),
    statusTotals,
    topUnmatched: topCounts(unmatchedCounts, 40),
    topUnknown: topCounts(unknownCounts, 40),
  };
}

function formatAggregate(a: any): string {
  return (
    `imgs=${a.images} ocr(mean/med)=${a.meanOcrMs.toFixed(1)}/${a.medianOcrMs.toFixed(1)}ms ` +
    `m/u/k=${a.meanMatched.toFixed(2)}/${a.meanUnmatched.toFixed(2)}/${a.meanUnknown.toFixed(2)} ` +
    `status=${JSON.stringify(a.statusTotals)}`
  );
}

/** Same recognize options as src/lib/ocrPaddle.ts and the app's Paddle pass. */
const OCR_OPTIONS = { flatten: true, minimumConfidence: 0.4, strategy: 'per-line' };

/**
 * Mirror the app's strip recovery (src/lib/ocrPaddle.ts) with the pure helpers
 * from src/lib/autoCrop.ts. Returns the first-pass text unchanged unless the
 * image is an extreme strip with too few characters for its width, in which
 * case the merged tile text replaces it only when it is longer.
 */
async function recognizeWithStripRecovery(
  svc: PaddleOcrService,
  arrayBuffer: ArrayBuffer,
  firstPassText: string,
  enabled: boolean
): Promise<{ text: string; stripRecovery: any | null }> {
  let text = firstPassText;
  if (!enabled || text.length >= OCR_STRIP_SCAN_MAX_CHARS) return { text, stripRecovery: null };
  try {
    const src = await loadImage(Buffer.from(arrayBuffer));
    const plan = planStripTiles(text.length, src.width, src.height);
    if (!plan) return { text, stripRecovery: null };
    const rects = tileRects(src.width, src.height, plan);
    const tileTexts: string[] = [];
    for (const rect of rects) {
      const canvas = createCanvas(rect.width, rect.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(src, rect.originX, rect.originY, rect.width, rect.height, 0, 0, rect.width, rect.height);
      const png = canvas.toBuffer('image/png');
      const tileAb = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
      const tileRes = await svc.recognize(tileAb, OCR_OPTIONS);
      tileTexts.push(tileRes.text ?? '');
    }
    const merged = mergeOcrTileTexts(tileTexts);
    const info = {
      tiles: rects.length,
      before: text.length,
      merged: merged.length,
      kept: merged.length > text.length,
    };
    if (info.kept) text = merged;
    return { text, stripRecovery: info };
  } catch (err) {
    return { text, stripRecovery: { error: String(err) } };
  }
}

function writeManifestWithKind(manifestPath: string, classified: any[]): void {
  if (!manifestPath || !existsSync(manifestPath)) {
    console.log('--write-manifest-kind: manifest not found, skipped');
    return;
  }
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.log(`--write-manifest-kind: could not parse manifest, skipped (${String(err)})`);
    return;
  }
  const arr: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.images) ? raw.images : [];
  const kindByFile = new Map(classified.map((c) => [c.rel, c.kind]));
  const merged = arr.map((e) =>
    e && typeof e.file === 'string'
      ? { ...e, kind: kindByFile.get(e.file.replace(/\\/g, '/')) ?? e.kind }
      : e
  );
  const target = path.join(path.dirname(manifestPath), 'manifest.with-kind.json');
  writeFileSync(target, JSON.stringify(merged, null, 1) + '\n', 'utf8');
  console.log(`--write-manifest-kind: wrote ${target} (original manifest untouched)`);
}

async function main(): Promise<void> {
  const {
    dir,
    out,
    kind: kindFilter,
    manifest,
    writeManifestKind,
    stripRecovery: stripRecoveryEnabled,
  } = parseArgs(process.argv.slice(2));

  if (!existsSync(dir)) {
    console.log(`image folder not found: ${dir}`);
    console.log('nothing to do (exit 0).');
    console.log('');
    console.log('Put label photos in that folder, then re-run:');
    console.log(`  npx tsx scripts/eval-real.ts --dir ${dir.replace(/\\/g, '/')} --out ${out.replace(/\\/g, '/')}`);
    return;
  }

  const entries = loadManifest(manifest);
  const byBase = new Map<string, any>();
  for (const e of entries.values()) {
    const b = path.basename(e.file).toLowerCase();
    if (!byBase.has(b)) byBase.set(b, e);
  }
  const entryFor = (rel: string) =>
    entries.get(rel) ?? byBase.get(path.basename(rel).toLowerCase()) ?? undefined;

  const allFiles = walkImages(dir);
  const classified = allFiles.map((rel) => {
    const entry = entryFor(rel);
    return {
      rel,
      kind: classifyKind(rel, entry),
      source: sourceName(rel, entry),
      entry,
    };
  });

  const kindCounts: Record<string, number> = { label: 0, guide: 0, unknown: 0 };
  const sourceCountsAll: Record<string, number> = {};
  for (const c of classified) {
    kindCounts[c.kind]++;
    sourceCountsAll[c.source] = (sourceCountsAll[c.source] ?? 0) + 1;
  }

  const selected = kindFilter === 'all' ? classified : classified.filter((c) => c.kind === kindFilter);

  if (writeManifestKind) writeManifestWithKind(manifest, classified);

  if (allFiles.length === 0) {
    console.log(`no image files in: ${dir} (recursive)`);
    console.log('nothing to do (exit 0). Supported: .jpg .jpeg .png .webp .bmp');
    console.log('');
    console.log('Put label photos in that folder, then re-run:');
    console.log(`  npx tsx scripts/eval-real.ts --dir ${dir.replace(/\\/g, '/')} --out ${out.replace(/\\/g, '/')}`);
    return;
  }

  console.log(`folder : ${dir} (recursive)`);
  console.log(`images : ${allFiles.length} found, ${selected.length} selected by --kind ${kindFilter}`);
  console.log(`manifest: ${manifest} (${entries.size} entries)`);
  console.log(`model  : V5_MOBILE_MODEL (cache: ${CACHE_DIR})`);
  console.log('');
  console.log('=== PER-KIND COUNTS (classified corpus) ===');
  for (const k of KINDS) console.log(`${k.padEnd(7)}: ${kindCounts[k]}`);
  console.log(`total  : ${allFiles.length}`);

  if (selected.length === 0) {
    console.log(`no images of kind "${kindFilter}" in corpus; nothing to OCR (exit 0).`);
    return;
  }

  const t0 = Date.now();
  const service = new PaddleOcrService({ model: V5_MOBILE_MODEL });
  await service.initialize();
  const initMs = Date.now() - t0;
  console.log(`init   : ${initMs}ms`);
  console.log('');

  const curated = getCuratedIndex();
  const catalog = getCatalogIndex();

  const images: any[] = [];

  for (const c of selected) {
    const full = path.join(dir, c.rel);
    const buf = readFileSync(full);
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    const t1 = Date.now();
    let text = '';
    let stripRecovery: any = null;
    let ocrError: string | null = null;
    try {
      const result = await service.recognize(arrayBuffer, OCR_OPTIONS);
      text = result.text ?? '';
      const recovered = await recognizeWithStripRecovery(
        service,
        arrayBuffer,
        text,
        stripRecoveryEnabled
      );
      text = recovered.text;
      stripRecovery = recovered.stripRecovery;
    } catch (err) {
      ocrError = String(err);
    }
    const ocrMs = Date.now() - t1;

    const section = extractIngredientSection(text);
    const findings = ocrError ? [] : analyzeLayered(curated, catalog, section);

    const matched = findings.filter((f) => f.match);
    const unknown = matched.filter((f) => f.match!.entry.status === 'unknown');
    const unmatched = findings.filter((f) => !f.match);

    const localStatusTotals: Record<string, number> = { halal: 0, haram: 0, syubhat: 0, unknown: 0 };
    for (const f of matched) {
      const status = f.match!.entry.status;
      localStatusTotals[status] = (localStatusTotals[status] ?? 0) + 1;
    }

    images.push({
      file: c.rel,
      kind: c.kind,
      source: c.source,
      ocrMs,
      rawChars: text.length,
      sectionChars: section.length,
      matched: matched.length,
      unmatched: unmatched.length,
      unknown: unknown.length,
      statusTotals: localStatusTotals,
      matchedList: matched.map(
        (f) => `${f.raw}=${f.match!.entry.status}(${f.match!.entry.id})`
      ),
      // Full finding records (matchedTerm/reviewed included) so validate-real's
      // harness mode can mirror measure.ts alignment exactly. matchedList is
      // kept for backward compatibility.
      findings: findings.map((f) => ({
        raw: f.raw,
        status: f.match ? f.match.entry.status : 'unmatched',
        entryId: f.match ? f.match.entry.id : null,
        matchedTerm: f.match ? f.match.matchedTerm : null,
        kind: f.match ? f.match.kind : null,
        reviewed: f.match ? f.match.entry.reviewed : undefined,
      })),
      unmatchedTokens: unmatched.map((f) => f.raw),
      unknownTokens: unknown.map((f) => f.raw),
      section,
      rawText: text,
      ...(stripRecovery ? { stripRecovery } : {}),
      ...(ocrError ? { ocrError } : {}),
    });

    console.log(
      `  [${c.kind}] ${c.rel}  ocr=${ocrMs}ms raw=${text.length} section=${section.length} ` +
        `matched=${matched.length} unmatched=${unmatched.length} unknown=${unknown.length}` +
        (stripRecovery
          ? ` strip=${stripRecovery.tiles ?? '?'} ${stripRecovery.before}->${stripRecovery.merged}` +
            (stripRecovery.kept ? ' KEPT' : ' kept-first')
          : '')
    );
  }

  const aggregate = buildAggregate(images, initMs);

  const byKind: Record<string, any> = {};
  for (const k of KINDS) {
    const imgs = images.filter((i) => i.kind === k);
    if (imgs.length > 0) byKind[k] = buildAggregate(imgs, initMs);
  }

  const sourceCounts: Record<string, number> = {};
  for (const i of images) sourceCounts[i.source] = (sourceCounts[i.source] ?? 0) + 1;

  const output = {
    generatedAt: new Date().toISOString(),
    note:
      'Real OCR on image files via ppu-paddle-ocr Node entry + onnxruntime-node, model V5_MOBILE_MODEL, ' +
      'options flatten/minimumConfidence=0.4/strategy=per-line (same as src/lib/ocrPaddle.ts). ' +
      'Matching pipeline: extractIngredientSection -> analyzeLayered(curated, catalog). ' +
      'Recursive image scan; per-image kind classification (label|guide|unknown), manifest-overridable; ' +
      '--kind filter selects processed images; byKind/sourceCounts describe the processed subset.',
    dir,
    manifest,
    model: 'V5_MOBILE_MODEL',
    kindFilter,
    stripRecovery: stripRecoveryEnabled,
    initMs,
    kindCounts: { ...kindCounts, total: allFiles.length },
    sourceCounts,
    images,
    aggregate,
    byKind,
  };

  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(output, null, 2), 'utf8');

  console.log('');
  console.log(`=== AGGREGATE (kind=${kindFilter}) ===`);
  console.log(`images         : ${aggregate.images}`);
  console.log(`init           : ${initMs}ms`);
  console.log(`ocr ms mean/med: ${aggregate.meanOcrMs.toFixed(1)} / ${aggregate.medianOcrMs.toFixed(1)}`);
  console.log(
    `matched mean   : ${aggregate.meanMatched.toFixed(2)}   unmatched mean: ${aggregate.meanUnmatched.toFixed(2)}   unknown mean: ${aggregate.meanUnknown.toFixed(2)}`
  );
  console.log(`status totals  : ${JSON.stringify(aggregate.statusTotals)}`);
  console.log('top unmatched  : ' + (aggregate.topUnmatched.length
    ? aggregate.topUnmatched.slice(0, 10).map(([t, c]) => `${t}×${c}`).join(', ')
    : '(none)'));
  console.log('top unknown    : ' + (aggregate.topUnknown.length
    ? aggregate.topUnknown.slice(0, 10).map(([t, c]) => `${t}×${c}`).join(', ')
    : '(none)'));

  console.log('');
  console.log('=== BY KIND (processed) ===');
  for (const k of KINDS) {
    if (byKind[k]) console.log(`${k.padEnd(7)}: ${formatAggregate(byKind[k])}`);
    else console.log(`${k.padEnd(7)}: not processed (kindCounts=${kindCounts[k]})`);
  }

  console.log('');
  console.log('=== SOURCE COUNTS (processed) ===');
  for (const [src, n] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(3)}  ${src}`);
  }

  console.log('');
  console.log(`wrote ${out}`);

  await service.destroy();
}

main().catch((err) => {
  console.error('eval-real failed:', err?.stack ?? String(err));
  console.error(`model cache dir: ${CACHE_DIR}`);
  process.exit(1);
});
