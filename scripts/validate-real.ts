/// <reference types="node" />
/**
 * validate-real.ts — golden-set run report (protocol §3 metrics, AC-1..AC-11).
 *
 *   # offline Paddle harness (produced by scripts/eval-real.ts)
 *   npx tsx scripts/eval-real.ts --dir D:/opencode/temp/labels --kind label \
 *     --out D:/opencode/temp/f8-harness.json
 *   npx tsx scripts/validate-real.ts --mode harness \
 *     --harness D:/opencode/temp/f8-harness.json \
 *     --gt D:/opencode/temp/goldenset/gt.json
 *
 *   # on-device scan-debug.jsonl
 *   npx tsx scripts/validate-real.ts --mode device \
 *     --jsonl runs/<run>/device.dev.scans.jsonl --gt <gt.json>
 *
 * Flags
 *   --strict                     exit 1 if any MUST threshold fails
 *   --overrides <file>           JSON object { "file|gtRaw": "finding substring" }
 *                                replacing the built-in table (measure.ts parity)
 *   --out <file.json>            write the full report
 *   --min-classification 0.90 --min-hazard 0.95 --max-unknown 0.03 --max-unmatched 0.07
 *   --max-false-halal 0 --max-false-haram 0
 *
 * Alignment is the audited measure.ts v2 approach: folding (CJK/katakana
 * look-alikes), matchedTerm + raw candidates, bracket-insensitive joined form,
 * greedy one-to-one by descending pairScore, explicit OVERRIDES first.
 *
 * OCR-level metrics need engine raw text. The current eval-real.ts harness
 * (pre-P0-4) does not emit it, so they are reported as n/a in harness mode;
 * device records carry `raw[].text`, so they are computed there.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  guessCategory,
  loadGtPath,
  type GtIngredient,
  type GtRecord,
} from './validate-ground-truth';

/* ------------------------------- types --------------------------------- */

const VERDICTS = new Set(['halal', 'haram', 'syubhat']);

interface Finding {
  raw: string;
  status: string; // halal | haram | syubhat | unknown | unmatched
  entryId: string | null;
  matchedTerm: string | null;
  kind: string | null;
  reviewed?: boolean;
}

interface RunImage {
  file: string;
  source: string;
  findings: Finding[];
  rawText: string | null;
  section: string | null;
  ocrMs: number | null;
}

interface Args {
  mode: 'harness' | 'device';
  harness: string | null;
  jsonl: string | null;
  gt: string | null;
  overrides: string | null;
  out: string | null;
  strict: boolean;
  minClassification: number;
  minHazard: number;
  maxUnknown: number;
  maxUnmatched: number;
  maxFalseHalal: number;
  maxFalseHaram: number;
}

interface AlignEntry {
  fi: number;
  score: number;
  via: string;
}

/* --------------------------- alignment core ---------------------------- */

function fold(s: string): string {
  return s
    .replace(/[增増曽]/g, '増')
    .replace(/[剂剤]/g, '剤')
    .replace(/[遗遺]/g, '遺')
    .replace(/[换換]/g, '換')
    .replace(/[盐塩]/g, '塩')
    .replace(/[酱醤]/g, '醤')
    .replace(/[类類]/g, '類')
    .replace(/[エ工]/g, 'エ')
    .replace(/[才オ]/g, 'オ')
    .replace(/[カ力]/g, 'カ')
    .replace(/[ニ二]/g, 'ニ')
    .replace(/[ロ口]/g, 'ロ')
    .replace(/[タ夕]/g, 'タ')
    .replace(/[ミ三]/g, 'ミ')
    .replace(/[ー一]/g, 'ー')
    .replace(/[ビ匕]/g, 'ビ')
    .replace(/[ペヘ丿]/g, 'ペ')
    .replace(/[りリ]/g, 'リ');
}

function surfaceNorm(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u3000\s]+/g, '')
    .replace(/[·・･]/g, '')
    .toLowerCase();
}

function coreForm(s: string): string {
  const cut = s.search(/[(（]/);
  const base = cut > 0 ? s.slice(0, cut) : s;
  return surfaceNorm(base);
}

const BRACKETS = /[()（）\[\]【】「」『』〈〉]/g;
const SEPARATORS = /[·・･/／,、，]/g;

function flatForm(s: string): string {
  return surfaceNorm(s).replace(BRACKETS, '').replace(SEPARATORS, '');
}

function looseForm(s: string): string {
  return fold(flatForm(s));
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function pairScore(gtRaw: string, fRaw: string): number {
  const gn = surfaceNorm(gtRaw);
  const gc = coreForm(gtRaw);
  const gf = flatForm(gtRaw);
  const gl = looseForm(gtRaw);

  const fn = surfaceNorm(fRaw);
  const fc = coreForm(fRaw);
  const ff = flatForm(fRaw);
  const fl = looseForm(fRaw);

  if (gn === fn) return 1;
  if (gc && fc && gc === fc) return 0.98;
  if (gl && fl && gl === fl) return 0.97;
  if (gf && ff && gf === ff) return 0.96;

  let best = 0;
  for (const [a, b] of [
    [gc, fc],
    [gl, fl],
    [gf, ff],
  ]) {
    if (!a || !b) continue;
    if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) {
      best = Math.max(best, 0.92);
    }
    const p = commonPrefix(a, b);
    if (p >= 3) best = Math.max(best, 0.6 + 0.35 * (p / Math.min(a.length, b.length)));
    const sim = 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);
    if (sim >= 0.65) best = Math.max(best, sim * 0.85);
  }
  return best;
}

function ocrHit(gtRaw: string, ocrLoose: string): { exact: boolean; variant: boolean } {
  const forms = [surfaceNorm(gtRaw), coreForm(gtRaw)].filter((f) => f.length > 0);
  for (const f of forms) {
    if (f.length >= 2 && ocrLoose.includes(f)) return { exact: true, variant: true };
  }
  const loose = looseForm(gtRaw);
  if (!loose || loose.length < 4) return { exact: false, variant: false };
  const budget = loose.length >= 8 ? Math.max(1, Math.floor(loose.length * 0.2)) : 1;
  for (const probe of [coreForm(gtRaw), loose].filter(Boolean)) {
    const p = fold(probe);
    if (p.length < 4) continue;
    for (let i = 0; i + p.length <= ocrLoose.length; i++) {
      const win = ocrLoose.slice(i, i + p.length);
      if (levenshtein(p, win) <= budget) return { exact: false, variant: true };
    }
  }
  return { exact: false, variant: false };
}

/** Built-in pins copied from D:/opencode/temp/goldenset/measure.ts (v2 table). */
const DEFAULT_OVERRIDES: Record<string, string> = {
  'off/off_4517888131963_ingredients.jpg|増粘剤（加工でん粉）': '加工でん粉',
  'off/off_4517888131963_ingredients.jpg|豆腐用凝固剤': '豆腐用凝固',
  'off/off_4901002173340_ingredients.jpg|酵母エキスパウダー': '酵母工キ',
  'off/off_4901002173340_ingredients.jpg|増粘剤（加工デンプン）': '加工デ プ',
  'off/off_4902431811575_ingredients.jpg|増粘剤（加工デンプン）': '加工デンプン',
  'off/off_4532508031157_ingredients.jpg|調味料（アミノ酸等）': '三ノ酸等',
  'off/off_2303797301427_ingredients.jpg|乳化剤': '乳化削香料',
  'off/off_2303797301427_ingredients.jpg|香料': '乳化削香料',
  'personal/fldb_4902750702042_label.jpg|イヌリン': 'イヌリンノ',
  'personal/fldb_4902750702042_label.jpg|酸味料': 'イヌリンノ 酸味料',
};

function alignImage(
  ingredients: GtIngredient[],
  findings: Finding[],
  file: string,
  overrides: Record<string, string>
): Map<number, AlignEntry> {
  const mapping = new Map<number, AlignEntry>();
  const used = new Set<number>();

  // explicit overrides first (many-to-one allowed)
  for (let gi = 0; gi < ingredients.length; gi++) {
    const key = `${file}|${ingredients[gi].raw}`;
    const target = overrides[key];
    if (!target) continue;
    const fi = findings.findIndex((f) => String(f.raw).includes(target));
    if (fi >= 0) {
      mapping.set(gi, { fi, score: 1, via: 'override' });
      used.add(fi);
    }
  }

  const pairs: { gi: number; fi: number; score: number; via: string }[] = [];
  for (let gi = 0; gi < ingredients.length; gi++) {
    if (mapping.has(gi)) continue;
    for (let fi = 0; fi < findings.length; fi++) {
      if (used.has(fi)) continue;
      const f = findings[fi];
      const candidates: [string, string][] = [[f.raw, 'raw']];
      if (f.matchedTerm) candidates.push([f.matchedTerm, 'matchedTerm']);
      let score = 0;
      let via = 'raw';
      for (const [c, name] of candidates) {
        const s = pairScore(ingredients[gi].raw, c);
        if (s > score) {
          score = s;
          via = name;
        }
      }
      if (score >= 0.6) pairs.push({ gi, fi, score, via });
    }
  }
  pairs.sort((x, y) => y.score - x.score || x.gi - y.gi || x.fi - y.fi);
  for (const p of pairs) {
    if (mapping.has(p.gi) || used.has(p.fi)) continue;
    mapping.set(p.gi, { fi: p.fi, score: p.score, via: p.via });
    used.add(p.fi);
  }
  return mapping;
}

/* ----------------------------- effectiveStatus ------------------------- */

/** Mirror of src/lib/verdict.ts effectiveStatus (unreviewed halal -> unknown). */
function effectiveStatus(f: { status: string; reviewed?: boolean }): string {
  if (f.reviewed === false && f.status === 'halal') return 'unknown';
  return f.status;
}

/* ------------------------------- parsing ------------------------------- */

function parseFindingToken(s: string): Finding | null {
  const close = s.lastIndexOf(')');
  if (close < 0) return null;
  const open = s.lastIndexOf('(', close);
  if (open < 0) return null;
  const entryId = s.slice(open + 1, close);
  const head = s.slice(0, open);
  const eq = head.lastIndexOf('=');
  if (eq <= 0) return null;
  return {
    raw: head.slice(0, eq),
    status: head.slice(eq + 1),
    entryId: entryId || null,
    matchedTerm: null,
    kind: null,
  };
}

function loadHarnessImages(file: string): RunImage[] {
  const raw: any = JSON.parse(readFileSync(file, 'utf8'));
  const images: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.images) ? raw.images : [];
  return images.map((img) => {
    const findings: Finding[] = [];
    for (const tok of img.matchedList ?? []) {
      const f = parseFindingToken(String(tok));
      if (f) findings.push(f);
    }
    for (const t of img.unmatchedTokens ?? []) {
      findings.push({ raw: String(t), status: 'unmatched', entryId: null, matchedTerm: null, kind: null });
    }
    const rawText: string | null =
      typeof img.rawText === 'string'
        ? img.rawText
        : Array.isArray(img.lines)
          ? img.lines.map((l: any) => String(l?.text ?? '')).join('\n')
          : null;
    return {
      file: String(img.file ?? ''),
      source: String(img.source ?? ''),
      findings,
      rawText,
      section: typeof img.section === 'string' ? img.section : null,
      ocrMs: typeof img.ocrMs === 'number' ? img.ocrMs : null,
    };
  });
}

interface DeviceRecord {
  type?: string;
  sid?: string;
  at?: string;
  ms?: number;
  hits?: string[];
  miss?: string[];
  section?: string;
  raw?: { label?: string; text?: string }[];
}

function loadDeviceRecords(file: string): DeviceRecord[] {
  const text = readFileSync(file, 'utf8');
  const out: DeviceRecord[] = [];
  const errors: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    try {
      const rec = JSON.parse(l);
      if (rec && typeof rec === 'object') out.push(rec);
    } catch {
      errors.push(l.slice(0, 80));
    }
  }
  const scans = out.filter((r) => !r.type || r.type === 'scan');
  scans.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')) || String(a.sid ?? '').localeCompare(String(b.sid ?? '')));
  if (errors.length) console.log(`warning: skipped ${errors.length} unparseable JSONL line(s)`);
  return scans;
}

function deviceRecordToImage(rec: DeviceRecord): RunImage {
  const findings: Finding[] = [];
  for (const tok of rec.hits ?? []) {
    const f = parseFindingToken(String(tok));
    if (f) findings.push(f);
  }
  for (const t of rec.miss ?? []) {
    findings.push({ raw: String(t), status: 'unmatched', entryId: null, matchedTerm: null, kind: null });
  }
  const rawText = Array.isArray(rec.raw) ? rec.raw.map((r) => String(r?.text ?? '')).join('\n') : null;
  return {
    file: rec.sid ? `scan:${rec.sid}` : 'scan:?',
    source: 'device',
    findings,
    rawText,
    section: typeof rec.section === 'string' ? rec.section : null,
    ocrMs: typeof rec.ms === 'number' ? rec.ms : null,
  };
}

/**
 * Correlate device scans to GT records. The record has no image name (P0-3 not
 * landed): use strict chronological order when counts match, else greedy text
 * similarity. Unmatched GT records are reported as image-missing.
 */
function correlateDevice(gtRecs: GtRecord[], scans: DeviceRecord[]): Map<number, RunImage> {
  const out = new Map<number, RunImage>();
  if (gtRecs.length === 0 || scans.length === 0) return out;
  if (gtRecs.length === scans.length) {
    for (let i = 0; i < gtRecs.length; i++) out.set(i, deviceRecordToImage(scans[i]));
    return out;
  }
  const expectedText = (r: GtRecord): string =>
    typeof r.gt_section === 'string'
      ? String(r.gt_section)
      : (r.ingredients ?? []).map((i) => i.raw).join('、');
  const jaccard = (a: string, b: string): number => {
    const ta = new Set((looseForm(a).match(/.{1,2}/g) ?? []).filter((x) => x.length === 2));
    const tb = new Set((looseForm(b).match(/.{1,2}/g) ?? []).filter((x) => x.length === 2));
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const x of ta) if (tb.has(x)) inter++;
    return inter / (ta.size + tb.size - inter);
  };
  const cands: { gi: number; si: number; score: number }[] = [];
  gtRecs.forEach((r, gi) => {
    scans.forEach((s, si) => {
      const score = jaccard(expectedText(r), `${s.section ?? ''}`);
      if (score > 0) cands.push({ gi, si, score });
    });
  });
  cands.sort((a, b) => b.score - a.score || a.gi - b.gi || a.si - b.si);
  const usedG = new Set<number>();
  const usedS = new Set<number>();
  for (const c of cands) {
    if (c.score < 0.25 || usedG.has(c.gi) || usedS.has(c.si)) continue;
    usedG.add(c.gi);
    usedS.add(c.si);
    out.set(c.gi, deviceRecordToImage(scans[c.si]));
  }
  return out;
}

/* -------------------------------- args --------------------------------- */

function parseArgs(argv: string[]): Args {
  const a: Args = {
    mode: 'harness',
    harness: null,
    jsonl: null,
    gt: null,
    overrides: null,
    out: null,
    strict: false,
    minClassification: 0.9,
    minHazard: 0.95,
    maxUnknown: 0.03,
    maxUnmatched: 0.07,
    maxFalseHalal: 0,
    maxFalseHaram: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const take = (): string | undefined => argv[++i];
    const num = (v: string | undefined, d: number): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };
    if (arg === '--mode') a.mode = (take() ?? a.mode) as Args['mode'];
    else if (arg.startsWith('--mode=')) a.mode = arg.slice(7) as Args['mode'];
    else if (arg === '--harness') a.harness = take() ?? a.harness;
    else if (arg.startsWith('--harness=')) a.harness = arg.slice(10);
    else if (arg === '--jsonl' || arg === '--scans') a.jsonl = take() ?? a.jsonl;
    else if (arg.startsWith('--jsonl=')) a.jsonl = arg.slice(8);
    else if (arg.startsWith('--scans=')) a.jsonl = arg.slice(8);
    else if (arg === '--gt') a.gt = take() ?? a.gt;
    else if (arg.startsWith('--gt=')) a.gt = arg.slice(5);
    else if (arg === '--overrides') a.overrides = take() ?? a.overrides;
    else if (arg.startsWith('--overrides=')) a.overrides = arg.slice(12);
    else if (arg === '--out') a.out = take() ?? a.out;
    else if (arg.startsWith('--out=')) a.out = arg.slice(6);
    else if (arg === '--strict') a.strict = true;
    else if (arg === '--min-classification') a.minClassification = num(take(), a.minClassification);
    else if (arg.startsWith('--min-classification=')) a.minClassification = num(arg.slice(21), a.minClassification);
    else if (arg === '--min-hazard') a.minHazard = num(take(), a.minHazard);
    else if (arg.startsWith('--min-hazard=')) a.minHazard = num(arg.slice(13), a.minHazard);
    else if (arg === '--max-unknown') a.maxUnknown = num(take(), a.maxUnknown);
    else if (arg.startsWith('--max-unknown=')) a.maxUnknown = num(arg.slice(14), a.maxUnknown);
    else if (arg === '--max-unmatched') a.maxUnmatched = num(take(), a.maxUnmatched);
    else if (arg.startsWith('--max-unmatched=')) a.maxUnmatched = num(arg.slice(16), a.maxUnmatched);
    else if (arg === '--max-false-halal') a.maxFalseHalal = num(take(), a.maxFalseHalal);
    else if (arg.startsWith('--max-false-halal=')) a.maxFalseHalal = num(arg.slice(18), a.maxFalseHalal);
    else if (arg === '--max-false-haram') a.maxFalseHaram = num(take(), a.maxFalseHaram);
    else if (arg.startsWith('--max-false-haram=')) a.maxFalseHaram = num(arg.slice(18), a.maxFalseHaram);
  }
  return a;
}

/* ------------------------------- output -------------------------------- */

function fmtPct(v: number): string {
  return `${(Math.round(v * 1000) / 10).toFixed(1)}%`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padL(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

interface ItemRow {
  file: string;
  category: string;
  gt: string;
  expected: string;
  hazard: boolean;
  status: string;
  effStatus: string;
  entryId: string | null;
  matchedTerm: string | null;
  alignScore: number | null;
  alignVia: string | null;
  ocrExact: boolean | null;
  ocrVariant: boolean | null;
  correct: boolean;
  failure: string | null;
}

/* --------------------------------- main -------------------------------- */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.gt) {
    console.error('error: --gt <file|dir> is required');
    process.exit(2);
  }
  if (!existsSync(args.gt)) {
    console.error(`error: --gt path not found: ${args.gt}`);
    process.exit(2);
  }

  const overrides: Record<string, string> = { ...DEFAULT_OVERRIDES };
  if (args.overrides) {
    if (!existsSync(args.overrides)) {
      console.error(`error: --overrides not found: ${args.overrides}`);
      process.exit(2);
    }
    const extra = JSON.parse(readFileSync(args.overrides, 'utf8'));
    for (const [k, v] of Object.entries(extra)) overrides[k] = String(v);
    console.log(`overrides: ${args.overrides} (${Object.keys(extra).length} entr(ies) merged over built-ins)`);
  }

  const gtLoad = loadGtPath(args.gt);
  if (gtLoad.records.length === 0) {
    console.error(`error: no GT records found in ${args.gt}`);
    process.exit(2);
  }
  const gtRecs = gtLoad.records;

  let harnessMap = new Map<string, RunImage>();
  let deviceMap: Map<number, RunImage> | null = null;
  let deviceScans: DeviceRecord[] = [];

  if (args.mode === 'harness') {
    if (!args.harness) {
      console.error('error: --mode harness requires --harness <harness.json>');
      process.exit(2);
    }
    if (!existsSync(args.harness)) {
      console.error(`error: --harness not found: ${args.harness}`);
      process.exit(2);
    }
    for (const img of loadHarnessImages(args.harness)) harnessMap.set(normKey(img.file), img);
  } else if (args.mode === 'device') {
    if (!args.jsonl) {
      console.error('error: --mode device requires --jsonl <scan-debug.jsonl>');
      process.exit(2);
    }
    if (!existsSync(args.jsonl)) {
      console.error(`error: --jsonl not found: ${args.jsonl}`);
      process.exit(2);
    }
    deviceScans = loadDeviceRecords(args.jsonl);
    deviceMap = correlateDevice(gtRecs, deviceScans);
  } else {
    console.error(`error: unknown --mode "${args.mode}" (expected harness | device)`);
    process.exit(2);
  }

  const rows: ItemRow[] = [];
  const coveredImages = new Set<string>();
  const harnessFilesSeen = new Set<string>();

  const statusOf = (img: RunImage | null, gi: number, al: Map<number, AlignEntry> | null): {
    f: Finding | null;
    entry: AlignEntry | null;
  } => {
    if (!img || !al) return { f: null, entry: null };
    const entry = al.get(gi) ?? null;
    return { f: entry ? img.findings[entry.fi] : null, entry };
  };

  gtRecs.forEach((rec, ri) => {
    const ing = rec.ingredients ?? [];
    let img: RunImage | null = null;
    if (args.mode === 'harness') {
      img = harnessMap.get(normKey(rec.file)) ?? null;
      if (img) harnessFilesSeen.add(normKey(rec.file));
    } else {
      img = deviceMap?.get(ri) ?? null;
    }
    const al = img ? alignImage(ing, img.findings, rec.file, overrides) : null;
    if (img) coveredImages.add(normKey(img.file));

    ing.forEach((g, gi) => {
      const { f } = statusOf(img, gi, al);
      const status = f ? f.status : 'unmatched';
      const eff = f ? effectiveStatus(f) : 'unmatched';
      const classified = VERDICTS.has(eff);
      const correct = classified && eff === g.expected;
      const ocrExact = img?.rawText != null ? ocrHit(g.raw, looseForm(img.rawText)).exact : null;
      const ocrVariant = img?.rawText != null ? ocrHit(g.raw, looseForm(img.rawText)).variant : null;

      let failure: string | null = null;
      if (!correct) {
        if (!img) failure = 'image-missing';
        else if (!f) {
          const inSection =
            img.section != null && ocrHit(g.raw, looseForm(img.section)).variant;
          failure = inSection ? 'extracted-not-matched' : 'never-emitted';
        } else if (status === 'unmatched') failure = 'unmatched';
        else if (status === 'unknown') failure = 'unknown-status';
        else failure = 'wrong-verdict';
      }

      rows.push({
        file: rec.file,
        category: guessCategory(rec),
        gt: g.raw,
        expected: g.expected,
        hazard: g.hazard === true || g.hazard === 1,
        status,
        effStatus: eff,
        entryId: f?.entryId ?? null,
        matchedTerm: f?.matchedTerm ?? null,
        alignScore: al?.get(gi)?.score ?? null,
        alignVia: al?.get(gi)?.via ?? null,
        ocrExact,
        ocrVariant,
        correct,
        failure,
      });
    });
  });

  const uncovered = gtRecs.filter((r) => !harnessFilesSeen.has(normKey(r.file)) && args.mode === 'harness');
  const coveredRows = rows.filter((r) => !uncovered.some((u) => normKey(u.file) === normKey(r.file)));
  const items = args.mode === 'harness' ? coveredRows : rows;
  const N = items.length;

  if (N === 0) {
    console.error('error: no GT occurrences matched the run input (0 covered items).');
    console.error('       check that harness `images[].file` uses the same relative paths as GT.');
    if (args.out) {
      mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
      writeFileSync(args.out, JSON.stringify({ error: 'no-covered-items', mode: args.mode }, null, 2), 'utf8');
    }
    process.exit(2);
  }

  const classified = items.filter((r) => VERDICTS.has(r.effStatus));
  const unknownItems = items.filter((r) => r.effStatus === 'unknown');
  const unmatchedItems = items.filter((r) => r.status === 'unmatched');
  const verdictCorrect = classified.filter((r) => r.effStatus === r.expected);
  const falseHalal = items.filter((r) => (r.expected === 'haram' || r.expected === 'syubhat') && r.effStatus === 'halal');
  const falseHaram = items.filter((r) => r.expected === 'halal' && r.effStatus === 'haram');
  const hazardItems = items.filter((r) => r.hazard);
  const hazardYield = hazardItems.filter((r) => VERDICTS.has(r.effStatus));
  const t2 = items.filter((r) => r.expected === 'halal' && r.effStatus === 'syubhat');
  const e2eCorrect = classified.filter((r) => r.effStatus === r.expected);

  const ocrCovered = items.filter((r) => r.ocrVariant !== null);
  const ocrExact = ocrCovered.filter((r) => r.ocrExact).length;
  const ocrVariant = ocrCovered.filter((r) => r.ocrVariant).length;

  const classificationRecall = classified.length / N;
  const hazardRecall = hazardItems.length ? hazardYield.length / hazardItems.length : 1;
  const unknownRate = unknownItems.length / N;
  const unmatchedRate = unmatchedItems.length / N;
  const verdictAccuracy = classified.length ? verdictCorrect.length / classified.length : 0;
  const e2eRecall = e2eCorrect.length / N;

  // Findings with a verdict that didn't align to any GT occurrence (noise leakage).
  let verdictFindings = 0;
  let alignedVerdictFindings = 0;
  const countLeakage = (img: RunImage, file: string): void => {
    const gtRec = gtRecs.find((r) => normKey(r.file) === normKey(file));
    const ing = gtRec?.ingredients ?? [];
    const al = alignImage(ing, img.findings, gtRec?.file ?? file, overrides);
    const usedFi = new Set([...al.values()].map((x) => x.fi));
    img.findings.forEach((f, fi) => {
      if (!VERDICTS.has(f.status)) return;
      verdictFindings++;
      if (usedFi.has(fi)) alignedVerdictFindings++;
    });
  };
  if (args.mode === 'harness') {
    for (const [key, img] of harnessMap) if (coveredImages.has(key)) countLeakage(img, key);
  } else if (deviceMap) {
    for (const [gi, img] of deviceMap) countLeakage(img, gtRecs[gi]?.file ?? img.file);
  }
  const noiseLeakage = verdictFindings ? Math.max(0, verdictFindings - alignedVerdictFindings) / verdictFindings : 0;

  const pct = (a: number, b: number): number => (b === 0 ? 0 : a / b);

  /* ----------------------------- thresholds ---------------------------- */

  interface Th {
    label: string;
    current: string;
    threshold: string;
    pass: boolean;
  }
  const th: Th[] = [
    {
      label: 'false-halal',
      current: String(falseHalal.length),
      threshold: `<= ${args.maxFalseHalal}`,
      pass: falseHalal.length <= args.maxFalseHalal,
    },
    {
      label: 'false-haram',
      current: String(falseHaram.length),
      threshold: `<= ${args.maxFalseHaram}`,
      pass: falseHaram.length <= args.maxFalseHaram,
    },
    {
      label: 'classification recall',
      current: fmtPct(classificationRecall),
      threshold: `>= ${fmtPct(args.minClassification)}`,
      pass: classificationRecall >= args.minClassification,
    },
    {
      label: 'hazard recall',
      current: fmtPct(hazardRecall),
      threshold: `>= ${fmtPct(args.minHazard)}`,
      pass: hazardRecall >= args.minHazard,
    },
    {
      label: 'unknown rate',
      current: fmtPct(unknownRate),
      threshold: `<= ${fmtPct(args.maxUnknown)}`,
      pass: unknownRate <= args.maxUnknown,
    },
    {
      label: 'unmatched rate',
      current: fmtPct(unmatchedRate),
      threshold: `<= ${fmtPct(args.maxUnmatched)}`,
      pass: unmatchedRate <= args.maxUnmatched,
    },
  ];
  const mustPass = th.every((x) => x.pass);

  /* -------------------------------- print ------------------------------ */

  console.log('');
  console.log(`=== validate-real (mode=${args.mode}) ===`);
  if (args.mode === 'harness') {
    console.log(`harness : ${args.harness}`);
    console.log(`gt      : ${args.gt}`);
    console.log(
      `covered : ${harnessFilesSeen.size}/${gtRecs.length} GT image(s); ${N} GT occurrence(s) scored` +
        (uncovered.length ? `; ${uncovered.length} GT image(s) not in harness` : '')
    );
  } else {
    console.log(`jsonl   : ${args.jsonl}`);
    console.log(`gt      : ${args.gt}`);
    console.log(`records : ${deviceScans.length} scan(s); ${deviceMap?.size ?? 0}/${gtRecs.length} correlated`);
  }
  console.log(`OCR text: ${ocrCovered.length ? `${ocrCovered.length} item(s) scored` : 'n/a (run input has no engine raw text; harness pre-P0-4)'}`);
  console.log('');

  console.log('--- MUST thresholds ---');
  const w = [24, 10, 14, 9];
  console.log(
    `  ${pad('metric', w[0])}${padL('current', w[1])}${padL('threshold', w[2])}${padL('verdict', w[3])}`
  );
  console.log(`  ${'-'.repeat(w[0] + w[1] + w[2] + w[3])}`);
  for (const t of th) {
    console.log(
      `  ${pad(t.label, w[0])}${padL(t.current, w[1])}${padL(t.threshold, w[2])}${padL(t.pass ? 'PASS' : 'FAIL', w[3])}`
    );
  }
  console.log('');

  console.log('--- other metrics ---');
  console.log(`  verdict accuracy (emitted) : ${fmtPct(verdictAccuracy)} (${verdictCorrect.length}/${classified.length})`);
  console.log(`  E2E correct recall         : ${fmtPct(e2eRecall)} (${e2eCorrect.length}/${N})`);
  console.log(`  hazard yield               : ${fmtPct(hazardRecall)} (${hazardYield.length}/${hazardItems.length})`);
  console.log(`  over-caution T2 (app syubhat, expected halal): ${t2.length} (${fmtPct(pct(t2.length, N))})`);
  if (ocrCovered.length) {
    console.log(`  OCR recall exact           : ${fmtPct(pct(ocrExact, ocrCovered.length))}`);
    console.log(`  OCR recall variant         : ${fmtPct(pct(ocrVariant, ocrCovered.length))}`);
  }
  console.log(`  noise leakage              : ${fmtPct(noiseLeakage)} (${verdictFindings - alignedVerdictFindings}/${verdictFindings} emitted findings unaligned)`);
  console.log('');

  /* ------------------------------ false halal -------------------------- */

  console.log(`FALSE-HALAL (${falseHalal.length}):`);
  if (!falseHalal.length) console.log('  (none)');
  for (const r of falseHalal) {
    console.log(`  !! ${r.file} | ${r.gt} | expected ${r.expected} got halal (${r.entryId ?? '-'})`);
  }
  console.log(`FALSE-HARAM (${falseHaram.length}):`);
  if (!falseHaram.length) console.log('  (none)');
  for (const r of falseHaram) {
    console.log(`  !! ${r.file} | ${r.gt} | expected ${r.expected} got haram (${r.entryId ?? '-'})`);
  }
  console.log('');

  /* ------------------------------ per-image ---------------------------- */

  const byFile = new Map<string, ItemRow[]>();
  for (const r of items) {
    const k = normKey(r.file);
    if (!byFile.has(k)) byFile.set(k, []);
    byFile.get(k)!.push(r);
  }
  console.log('--- per-image (GT-covered only) ---');
  const iw = [40, 4, 6, 4, 4, 4, 4, 3];
  console.log(
    `  ${pad('file', iw[0])}${padL('n', iw[1])}${padL('class', iw[2])}${padL('unk', iw[3])}${padL('unm', iw[4])}${padL('ok', iw[5])}${padL('FH', iw[6])}${padL('FR', iw[7])}`
  );
  console.log(`  ${'-'.repeat(iw.reduce((a, b) => a + b, 0))}`);
  const sortedFiles = [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, rs] of sortedFiles) {
    const cls = rs.filter((r) => VERDICTS.has(r.effStatus)).length;
    const unk = rs.filter((r) => r.effStatus === 'unknown').length;
    const unm = rs.filter((r) => r.status === 'unmatched').length;
    const ok = rs.filter((r) => r.correct).length;
    const fh = rs.filter((r) => (r.expected === 'haram' || r.expected === 'syubhat') && r.effStatus === 'halal').length;
    const fr = rs.filter((r) => r.expected === 'halal' && r.effStatus === 'haram').length;
    const label = k.length > iw[0] - 1 ? `…${k.slice(-(iw[0] - 1))}` : k;
    console.log(
      `  ${pad(label, iw[0])}${padL(String(rs.length), iw[1])}${padL(String(cls), iw[2])}${padL(String(unk), iw[3])}${padL(String(unm), iw[4])}${padL(String(ok), iw[5])}${padL(String(fh), iw[6])}${padL(String(fr), iw[7])}`
    );
  }
  console.log('');

  /* --------------------------- category rollup ------------------------- */

  const byCat = new Map<string, ItemRow[]>();
  for (const r of items) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category)!.push(r);
  }
  console.log('--- per-category rollup (heuristic) ---');
  console.log(
    `  ${pad('cat', 5)}${padL('n', 5)}${padL('class', 8)}${padL('unknown', 9)}${padL('unmatched', 11)}${padL('recall', 8)}`
  );
  for (const [c, rs] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cls = rs.filter((r) => VERDICTS.has(r.effStatus)).length;
    const unk = rs.filter((r) => r.effStatus === 'unknown').length;
    const unm = rs.filter((r) => r.status === 'unmatched').length;
    console.log(
      `  ${pad(c, 5)}${padL(String(rs.length), 5)}${padL(`${fmtPct(cls / rs.length)}`, 8)}${padL(fmtPct(unk / rs.length), 9)}${padL(fmtPct(unm / rs.length), 11)}${padL(fmtPct(cls / rs.length), 8)}`
    );
  }
  console.log('');

  /* ------------------------------ top misses --------------------------- */

  const misses = items
    .filter((r) => !r.correct)
    .sort((a, b) => a.file.localeCompare(b.file) || a.gt.localeCompare(b.gt));
  const missCounts = new Map<string, number>();
  for (const m of misses) missCounts.set(m.failure ?? '?', (missCounts.get(m.failure ?? '?') ?? 0) + 1);
  console.log(`--- top misses (${misses.length} total) ---`);
  console.log(
    '  failure class: ' +
      ([...missCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([k, n]) => `${k}=${n}`)
        .join(', ') || '(none)')
  );
  for (const m of misses.slice(0, 5)) {
    console.log(
      `  [${m.failure}] ${m.file} | ${m.gt} | expected ${m.expected} got ${m.effStatus}` +
        `${m.entryId ? ` (${m.entryId})` : ''}`
    );
  }
  console.log('');

  if (uncovered.length && args.mode === 'harness') {
    console.log(`GT images not present in harness (${uncovered.length}):`);
    for (const u of uncovered.slice(0, 20).sort((a, b) => a.file.localeCompare(b.file))) console.log(`  ${u.file}`);
    if (uncovered.length > 20) console.log(`  ... and ${uncovered.length - 20} more`);
    console.log('');
  }

  console.log(mustPass ? 'RESULT: all MUST thresholds PASS' : 'RESULT: MUST threshold failure(s) — see table above');
  if (args.strict) console.log('(--strict: exit 1 on any MUST failure)');
  console.log('LIMITATION: offline harness cannot validate ML Kit, adaptive 3rd pass, camera or MB-based crop.');

  /* ------------------------------ write JSON --------------------------- */

  if (args.out) {
    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.mode,
      inputs: {
        gt: args.gt,
        harness: args.harness,
        jsonl: args.jsonl,
        overrides: args.overrides,
      },
      coverage: {
        gtImages: gtRecs.length,
        gtImagesCovered: harnessFilesSeen.size,
        gtItemsScored: N,
        gtItemsSkipped: rows.length - N,
      },
      metrics: {
        classificationRecall: classificationRecall,
        hazardRecall,
        unknownRate,
        unmatchedRate,
        verdictAccuracy,
        e2eCorrectRecall: e2eRecall,
        overCautionT2: t2.length,
        noiseLeakage,
        ocrExact: ocrCovered.length ? pct(ocrExact, ocrCovered.length) : null,
        ocrVariant: ocrCovered.length ? pct(ocrVariant, ocrCovered.length) : null,
      },
      thresholds: th,
      mustPass,
      falseHalal: falseHalal.map(shaped),
      falseHaram: falseHaram.map(shaped),
      topMisses: misses.slice(0, 50).map(shaped),
      perImage: sortedFiles.map(([k, rs]) => ({
        file: k,
        n: rs.length,
        classified: rs.filter((r) => VERDICTS.has(r.effStatus)).length,
        unknown: rs.filter((r) => r.effStatus === 'unknown').length,
        unmatched: rs.filter((r) => r.status === 'unmatched').length,
        correct: rs.filter((r) => r.correct).length,
      })),
      rows: items.sort((a, b) => a.file.localeCompare(b.file) || a.gt.localeCompare(b.gt)),
    };
    mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    writeFileSync(args.out, JSON.stringify(report, null, 2), 'utf8');
    console.log(`wrote ${args.out}`);
  }

  process.exit(args.strict && !mustPass ? 1 : 0);
}

function shaped(r: ItemRow): Record<string, unknown> {
  return {
    file: r.file,
    gt: r.gt,
    expected: r.expected,
    status: r.status,
    effStatus: r.effStatus,
    entryId: r.entryId,
    matchedTerm: r.matchedTerm,
    hazard: r.hazard,
    failure: r.failure,
  };
}

function normKey(f: string): string {
  return String(f ?? '').replace(/\\/g, '/').trim().toLowerCase();
}

main().catch((err) => {
  console.error('validate-real failed:', err?.stack ?? String(err));
  process.exit(1);
});
