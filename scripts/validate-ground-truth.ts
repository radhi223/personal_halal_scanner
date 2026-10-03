/// <reference types="node" />
/**
 * validate-ground-truth.ts — AC-0 golden-set validity gate (protocol §1.0, §2).
 *
 *   npx tsx scripts/validate-ground-truth.ts --gt D:/opencode/temp/goldenset/gt.json
 *   npx tsx scripts/validate-ground-truth.ts --gt D:/opencode/temp/goldenset/gt.json \
 *       --holdout D:/opencode/temp/goldenset/holdout --report-only
 *
 * Inputs
 *   --gt <file|dir>       required. A JSON array, a { records | items | gt } wrapper,
 *                         a single record, or a .jsonl file. A directory is walked
 *                         recursively and every *.json / *.jsonl merged.
 *   --holdout <dir>       optional. Same formats; used for AC-0d (count + disjointness).
 *   --labels <dir>        corpus root image paths are resolved against
 *                         (default D:/opencode/temp/labels).
 *   --report-only         never exit non-zero because of failed minimums.
 *
 * Minimums (protocol AC-0 defaults, override with flags):
 *   --images 64  --occurrences 500  --hazards 90  --holdout-images 16  --real-photos 40
 *
 * Exit 0 only when ALL AC-0 minimums pass (unless --report-only). Schema / path
 * problems are reported as warnings and never flip the exit code by themselves.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------- types --------------------------------- */

export type Expected = 'halal' | 'haram' | 'syubhat' | 'unknown';

export interface GtIngredient {
  raw: string;
  expected: string;
  hazard?: boolean | number;
  note?: string;
  unreadable?: boolean;
  not_visible?: boolean;
}

export interface GtRecord {
  file: string;
  source?: unknown;
  productName?: string;
  ingredients?: GtIngredient[];
  gt_tokens?: { text?: string; expected?: string; hazard?: boolean; note?: string }[];
  notes?: string;
  [key: string]: unknown;
}

export interface LoadResult {
  records: GtRecord[];
  files: string[];
  parseErrors: string[];
  imageFileCount: number;
}

interface Ac0Row {
  key: string;
  label: string;
  current: number;
  minimum: number;
  pass: boolean;
}

interface Args {
  gt: string | null;
  holdout: string | null;
  labels: string;
  reportOnly: boolean;
  images: number;
  occurrences: number;
  hazards: number;
  holdoutImages: number;
  realPhotos: number;
}

/* ------------------------------- loading ------------------------------- */

export function normalizeRecord(r: any): GtRecord {
  const rec: GtRecord = { ...(r ?? {}) };
  if (typeof rec.file !== 'string' || !rec.file) {
    if (typeof rec.id === 'string') rec.file = rec.id;
    else rec.file = '';
  }
  if (!Array.isArray(rec.ingredients) && Array.isArray(rec.gt_tokens)) {
    rec.ingredients = rec.gt_tokens.map((t: any) => ({
      raw: String(t?.text ?? ''),
      expected: String(t?.expected ?? ''),
      hazard: !!t?.hazard,
      ...(t?.note ? { note: String(t.note) } : {}),
    }));
  }
  return rec;
}

function parseGtText(text: string, source: string, errors: string[]): GtRecord[] {
  const out: GtRecord[] = [];
  const trimmed = text.trim();
  if (!trimmed) return out;

  // Try whole-file JSON first (array / wrapper / single record).
  try {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.records)
        ? parsed.records
        : Array.isArray(parsed?.items)
          ? parsed.items
          : Array.isArray(parsed?.gt)
            ? parsed.gt
            : [parsed];
    for (const item of arr) if (item && typeof item === 'object') out.push(normalizeRecord(item));
    return out;
  } catch {
    // fall through to JSONL
  }

  // JSONL: one record per line.
  for (const line of trimmed.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    try {
      const item = JSON.parse(l);
      if (item && typeof item === 'object') out.push(normalizeRecord(item));
    } catch (err) {
      errors.push(`${source}: ${String(err)}`);
    }
  }
  return out;
}

function collectDataFiles(root: string): string[] {
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
      else if (/\.(json|jsonl)$/i.test(name)) out.push(full);
    }
  };
  visit(root);
  return out;
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

export function countImageFiles(root: string): number {
  let n = 0;
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
      else if (IMAGE_EXT.has(path.extname(name).toLowerCase())) n++;
    }
  };
  visit(root);
  return n;
}

/** Load GT records from a file or directory (recursive json/jsonl merge). */
export function loadGtPath(input: string): LoadResult {
  const res: LoadResult = { records: [], files: [], parseErrors: [], imageFileCount: 0 };
  if (!existsSync(input)) {
    res.parseErrors.push(`${input}: path does not exist`);
    return res;
  }
  const st = statSync(input);
  if (st.isDirectory()) {
    const files = collectDataFiles(input);
    res.files = files;
    for (const f of files) {
      try {
        res.records.push(...parseGtText(readFileSync(f, 'utf8'), f, res.parseErrors));
      } catch (err) {
        res.parseErrors.push(`${f}: ${String(err)}`);
      }
    }
    res.imageFileCount = countImageFiles(input);
  } else {
    res.files = [input];
    try {
      res.records = parseGtText(readFileSync(input, 'utf8'), input, res.parseErrors);
    } catch (err) {
      res.parseErrors.push(`${input}: ${String(err)}`);
    }
    res.imageFileCount = res.records.length > 0 ? 0 : 0;
  }
  return res;
}

/* ------------------------------ helpers -------------------------------- */

const VALID_EXPECTED: Expected[] = ['halal', 'haram', 'syubhat', 'unknown'];

function asSourceText(source: unknown): string {
  if (typeof source === 'string') return source;
  if (source && typeof source === 'object') {
    const s = source as Record<string, unknown>;
    return [s.kind, s.name, s.url].filter(Boolean).map(String).join(' ');
  }
  return '';
}

function isGuideSource(source: unknown): boolean {
  const s = asSourceText(source).toLowerCase();
  return /(^|\b)(caa|tokyo|guide)(\b|$)|消費者庁|東京都/.test(s);
}

function truthy(v: unknown): boolean {
  return v === true || v === 1;
}

function normFile(f: string): string {
  return String(f ?? '').replace(/\\/g, '/').trim().toLowerCase();
}

function basename(f: string): string {
  return normFile(f).split('/').pop() ?? '';
}

/** Heuristic category guess from product name + notes (protocol §2.1 codes). */
const CATEGORY_HINTS: [string, RegExp][] = [
  ['ND', /ラーメン|即席|カップ麺|インスタント|noodle|うどん|そば/i],
  ['DR', /サイダー|コーラ|ドリンク|飲料|ジュース|お茶|麦茶|水|ビール|ペットボトル|缶/i],
  ['DY', /チーズ|ヨーグルト|牛乳|乳製品|バター|生クリーム|dairy|cheese|milk/i],
  ['BR', /パン|食パン|ロール|bread/i],
  ['FZ', /冷凍|アイス|frozen/i],
  ['PM', /弁当|惣菜|レトルト|カレー|調理済|prepared|meal/i],
  ['SE', /ソース|醤油|しょうゆ|みそ|味噌|調味料|香辛料|だし|sauce|seasoning|ドレッシング/i],
  ['SN', /菓子|スナック|チップス|クッキー|チョコ|飴|グミ|snack|candy|ポテト/i],
];

export function guessCategory(rec: GtRecord): string {
  const hay = `${rec.productName ?? ''} ${rec.notes ?? ''} ${(rec.ingredients ?? [])
    .map((i) => i.raw)
    .join(' ')}`;
  for (const [code, re] of CATEGORY_HINTS) if (re.test(hay)) return code;
  return '??';
}

const DIFFICULTY_FLAGS: [string, RegExp][] = [
  ['curved', /\bcurved\b/i],
  ['glare', /\bglare\b/i],
  ['vertical', /\bvertical\b/i],
  ['small_font', /small[_ ]?font/i],
  ['multi_column', /multi[_ ]?column/i],
  ['handwriting', /handwriting/i],
  ['partial', /\bpartial\b/i],
  ['low_res', /low[_ ]?res/i],
  ['extract_gap', /EXTRACT-GAP/i],
  ['noise_overreach', /NOISE-OVERREACH/i],
  ['ocr_fragment', /OCR-fragment|fragment case/i],
];

function parseArgs(argv: string[]): Args {
  const a: Args = {
    gt: null,
    holdout: null,
    labels: 'D:/opencode/temp/labels',
    reportOnly: false,
    images: 64,
    occurrences: 500,
    hazards: 90,
    holdoutImages: 16,
    realPhotos: 40,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const take = (): string | undefined => argv[++i];
    const num = (v: string | undefined, d: number): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };
    if (arg === '--gt') a.gt = take() ?? a.gt;
    else if (arg.startsWith('--gt=')) a.gt = arg.slice(5);
    else if (arg === '--holdout') a.holdout = take() ?? a.holdout;
    else if (arg.startsWith('--holdout=')) a.holdout = arg.slice(10);
    else if (arg === '--labels') a.labels = take() ?? a.labels;
    else if (arg.startsWith('--labels=')) a.labels = arg.slice(9);
    else if (arg === '--report-only') a.reportOnly = true;
    else if (arg === '--images') a.images = num(take(), a.images);
    else if (arg.startsWith('--images=')) a.images = num(arg.slice(9), a.images);
    else if (arg === '--occurrences') a.occurrences = num(take(), a.occurrences);
    else if (arg.startsWith('--occurrences=')) a.occurrences = num(arg.slice(14), a.occurrences);
    else if (arg === '--hazards') a.hazards = num(take(), a.hazards);
    else if (arg.startsWith('--hazards=')) a.hazards = num(arg.slice(10), a.hazards);
    else if (arg === '--holdout-images') a.holdoutImages = num(take(), a.holdoutImages);
    else if (arg.startsWith('--holdout-images=')) a.holdoutImages = num(arg.slice(17), a.holdoutImages);
    else if (arg === '--real-photos') a.realPhotos = num(take(), a.realPhotos);
    else if (arg.startsWith('--real-photos=')) a.realPhotos = num(arg.slice(14), a.realPhotos);
  }
  return a;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padL(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function printTable(rows: Ac0Row[], minLabel: string): void {
  const w = [26, 9, 10, 9];
  console.log(
    `  ${pad('criterion', w[0])}${padL('current', w[1])}${padL(minLabel, w[2])}${padL('verdict', w[3])}`
  );
  console.log(`  ${'-'.repeat(w[0] + w[1] + w[2] + w[3])}`);
  for (const r of rows) {
    console.log(
      `  ${pad(r.label, w[0])}${padL(String(r.current), w[1])}${padL(String(r.minimum), w[2])}${padL(
        r.pass ? 'PASS' : 'FAIL',
        w[3]
      )}`
    );
  }
}

/* -------------------------------- main --------------------------------- */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.gt) {
    console.error('error: --gt <file|dir> is required');
    console.error('usage: npx tsx scripts/validate-ground-truth.ts --gt <gt.json|dir> [--holdout <dir>] [--report-only]');
    process.exit(2);
  }
  if (!existsSync(args.gt)) {
    console.error(`error: --gt path not found: ${args.gt}`);
    process.exit(2);
  }

  const dev = loadGtPath(args.gt);
  if (dev.parseErrors.length && dev.records.length === 0) {
    console.error('error: could not parse GT input:');
    for (const e of dev.parseErrors) console.error(`  ${e}`);
    process.exit(2);
  }
  if (dev.records.length === 0) {
    console.error(`error: no GT records found in ${args.gt}`);
    process.exit(2);
  }

  let holdout: LoadResult = { records: [], files: [], parseErrors: [], imageFileCount: 0 };
  if (args.holdout) {
    if (!existsSync(args.holdout)) {
      console.error(`error: --holdout path not found: ${args.holdout}`);
      process.exit(2);
    }
    holdout = loadGtPath(args.holdout);
  }

  const holdoutRecs = holdout.records;
  const holdoutImgCount = holdoutRecs.length > 0 ? holdoutRecs.length : holdout.imageFileCount;
  const allRecords = [...dev.records, ...holdoutRecs];

  // AC-0a..e counters.
  const imagesCount = dev.records.length + holdoutImgCount;
  const occurrences = allRecords.reduce((n, r) => n + (r.ingredients?.length ?? 0), 0);
  const hazards = allRecords.reduce(
    (n, r) => n + (r.ingredients ?? []).filter((i) => truthy(i.hazard)).length,
    0
  );
  const realPhotos = allRecords.filter((r) => !isGuideSource(r.source)).length;

  // AC-0d disjointness: full normalized file path OR basename present in both sets.
  const devFull = new Map<string, string>();
  const devBase = new Map<string, string>();
  for (const r of dev.records) {
    const f = normFile(r.file);
    if (f) {
      devFull.set(f, r.file);
      devBase.set(basename(f), r.file);
    }
  }
  const overlaps: string[] = [];
  for (const r of holdoutRecs) {
    const f = normFile(r.file);
    if (!f) continue;
    if (devFull.has(f) || devBase.has(basename(f))) overlaps.push(r.file);
  }
  const holdoutDisjoint = overlaps.length === 0;

  const rows: Ac0Row[] = [
    { key: 'AC-0a', label: 'AC-0a golden images', current: imagesCount, minimum: args.images, pass: imagesCount >= args.images },
    { key: 'AC-0b', label: 'AC-0b GT occurrences', current: occurrences, minimum: args.occurrences, pass: occurrences >= args.occurrences },
    { key: 'AC-0c', label: 'AC-0c hazard occurrences', current: hazards, minimum: args.hazards, pass: hazards >= args.hazards },
    { key: 'AC-0d', label: 'AC-0d holdout images', current: holdoutImgCount, minimum: args.holdoutImages, pass: holdoutImgCount >= args.holdoutImages && holdoutDisjoint },
    { key: 'AC-0e', label: 'AC-0e real photos', current: realPhotos, minimum: args.realPhotos, pass: realPhotos >= args.realPhotos },
  ];
  const allPass = rows.every((r) => r.pass);

  console.log('');
  console.log('=== validate-ground-truth (AC-0) ===');
  console.log(`gt      : ${args.gt} (${dev.files.length} file(s), ${dev.records.length} record(s))`);
  if (args.holdout) {
    console.log(
      `holdout : ${args.holdout} (${holdoutRecs.length} record(s)${holdoutRecs.length === 0 ? `, ${holdout.imageFileCount} image file(s)` : ''})`
    );
  } else {
    console.log('holdout : (not provided)');
  }
  console.log('');
  console.log(`N total : ${occurrences} occurrences, ${hazards} hazard, ${imagesCount} images`);
  console.log('');
  printTable(rows, 'minimum');
  console.log('');
  console.log(`AC-0d disjointness: ${holdoutDisjoint ? 'PASS (no overlap)' : `FAIL — ${overlaps.length} file(s) in both dev and holdout`}`);
  for (const o of overlaps.slice(0, 20)) console.log(`  overlap: ${o}`);

  /* ---------------------- schema / path validation ---------------------- */

  const invalidExpected: string[] = [];
  const missingFields: string[] = [];
  const noIngredients: string[] = [];
  const dupMap = new Map<string, number>();
  const dupFiles: string[] = [];
  let ingredientCount = 0;

  for (const r of allRecords) {
    const f = normFile(r.file);
    if (!f) missingFields.push(`(record without file): productName=${r.productName ?? '?'}`);
    if (f) {
      const prev = dupMap.get(f) ?? 0;
      dupMap.set(f, prev + 1);
      if (prev === 1) dupFiles.push(r.file);
    }
    const ings = r.ingredients;
    if (!Array.isArray(ings) || ings.length === 0) {
      noIngredients.push(r.file || '(no file)');
      continue;
    }
    for (const ing of ings) {
      ingredientCount++;
      if (!ing || typeof ing.raw !== 'string' || !ing.raw || typeof ing.expected !== 'string' || !ing.expected || !('hazard' in ing)) {
        missingFields.push(`${r.file} :: ${ing?.raw ?? '?'}`);
      }
      if (ing && typeof ing.expected === 'string' && ing.expected && !VALID_EXPECTED.includes(ing.expected as Expected)) {
        invalidExpected.push(`${r.file} :: ${ing.raw} -> "${ing.expected}"`);
      }
    }
  }

  const missingImages: string[] = [];
  for (const r of allRecords) {
    if (!r.file) continue;
    const abs = path.resolve(args.labels, r.file);
    if (!existsSync(abs)) missingImages.push(r.file);
  }

  // Duplicate filenames across the merged set (same basename, different folders).
  const baseCounts = new Map<string, number>();
  for (const r of allRecords) {
    const b = basename(r.file);
    if (b) baseCounts.set(b, (baseCounts.get(b) ?? 0) + 1);
  }
  const dupBasenames = [...baseCounts.entries()].filter(([, n]) => n > 1).map(([b]) => b).sort();

  console.log('');
  console.log('=== schema / path validation ===');
  console.log(`ingredients parsed        : ${ingredientCount}`);
  console.log(`records without ingredients: ${noIngredients.length}`);
  console.log(`missing raw/expected/hazard: ${missingFields.length}`);
  console.log(`invalid expected value     : ${invalidExpected.length}`);
  console.log(`duplicate file paths       : ${dupFiles.length}`);
  console.log(`duplicate basenames        : ${dupBasenames.length}`);
  console.log(`missing image files        : ${missingImages.length} (root: ${args.labels})`);
  for (const x of invalidExpected.slice(0, 20)) console.log(`  invalid-expected: ${x}`);
  for (const x of missingFields.slice(0, 20)) console.log(`  missing-field: ${x}`);
  for (const x of noIngredients.slice(0, 20)) console.log(`  no-ingredients: ${x}`);
  for (const x of dupFiles.slice(0, 20)) console.log(`  duplicate: ${x}`);
  for (const x of dupBasenames.slice(0, 10)) console.log(`  duplicate-basename: ${x}`);
  for (const x of missingImages.slice(0, 40)) console.log(`  missing-image: ${x}`);
  if (missingImages.length > 40) console.log(`  ... and ${missingImages.length - 40} more`);
  if (dev.parseErrors.length) {
    for (const e of dev.parseErrors.slice(0, 20)) console.log(`  parse-error(dev): ${e}`);
  }
  if (holdout.parseErrors.length) {
    for (const e of holdout.parseErrors.slice(0, 20)) console.log(`  parse-error(holdout): ${e}`);
  }

  /* ------------------------ category coverage --------------------------- */

  const sourceCounts = new Map<string, number>();
  for (const r of allRecords) {
    const s = asSourceText(r.source) || '(none)';
    sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
  }
  const catCounts = new Map<string, number>();
  for (const r of allRecords) {
    const c = guessCategory(r);
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const flagCounts = new Map<string, number>();
  for (const r of allRecords) {
    const hay = `${r.notes ?? ''}`;
    for (const [flag, re] of DIFFICULTY_FLAGS) {
      if (re.test(hay)) flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
    }
  }
  const sorted = (m: Map<string, number>): [string, number][] =>
    [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));

  console.log('');
  console.log('=== category coverage (heuristic) ===');
  console.log('category distribution:');
  for (const [c, n] of sorted(catCounts)) console.log(`  ${pad(c, 4)} ${n}`);
  const missingCats = ['SN', 'FZ', 'SE', 'DR', 'ND', 'DY', 'BR', 'PM'].filter((c) => !catCounts.has(c));
  console.log(`  categories absent: ${missingCats.length ? missingCats.join(', ') : '(none)'}`);
  console.log('source distribution:');
  for (const [s, n] of sorted(sourceCounts)) console.log(`  ${padL(String(n), 4)}  ${s}`);
  console.log('difficulty flags parsed from notes:');
  if (flagCounts.size === 0) console.log('  (none)');
  for (const [f, n] of sorted(flagCounts)) console.log(`  ${pad(f, 18)} ${n}`);

  console.log('');
  if (allPass) {
    console.log('RESULT: AC-0 PASS — golden set meets every minimum.');
  } else {
    const failed = rows.filter((r) => !r.pass).map((r) => r.key);
    console.log(`RESULT: AC-0 FAIL — unmet: ${failed.join(', ')}`);
    if (holdoutImgCount >= args.holdoutImages && !holdoutDisjoint) {
      console.log('        (AC-0d count met but dev/holdout are NOT disjoint)');
    }
  }
  if (args.reportOnly) console.log('(--report-only: exit code forced to 0)');

  process.exit(args.reportOnly || allPass ? 0 : 1);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error('validate-ground-truth failed:', err?.stack ?? String(err));
    process.exit(1);
  });
}
