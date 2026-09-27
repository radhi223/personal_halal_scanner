/**
 * Offline evaluation harness for the halal matching core.
 *
 * Measures ingredient-matching accuracy on SYNTHETIC Japanese labels built from
 * the OFF-JP token frequency corpus, then injects seeded OCR-style errors and
 * re-measures. No phone / camera / native modules involved.
 *
 * Pipeline under test (the REAL one):
 *   extractIngredientSection(text) -> analyzeLayered(curated, catalog, section)
 *
 * Run:
 *   npx tsx scripts/eval.ts
 *   npx tsx scripts/eval.ts --n 300 --err 0.15 --seed 12345
 *
 * Output:
 *   D:/opencode/temp/eval-baseline.json
 *
 * NOTE: text is synthetic (token soup + header/nutrition boilerplate), NOT real
 * photos, so OCR error shape is approximated. This is a regression baseline.
 */
// @ts-nocheck
import { readFileSync, writeFileSync } from 'node:fs';

import { substitutionCost } from '@/lib/confusion';
import { getCatalogIndex, getCuratedIndex } from '@/lib/database';
import { analyzeLayered } from '@/lib/matcher';
import { extractIngredientSection, isLabelNoise, normalize } from '@/lib/normalize';

const CORPUS_PATH = 'D:/opencode/temp/jp-token-freq.json';
const OUT_PATH = 'D:/opencode/temp/eval-baseline.json';

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32). No Math.random anywhere.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
interface Config {
  n: number;
  err: number;
  seed: number;
}

function parseArgs(argv: string[]): Config {
  const cfg: Config = { n: 300, err: 0.15, seed: 12345 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = (): string | undefined => argv[++i];
    if (a === '--n') cfg.n = Number(take() ?? cfg.n);
    else if (a.startsWith('--n=')) cfg.n = Number(a.slice(4));
    else if (a === '--err') cfg.err = Number(take() ?? cfg.err);
    else if (a.startsWith('--err=')) cfg.err = Number(a.slice(6));
    else if (a === '--seed') cfg.seed = Number(take() ?? cfg.seed);
    else if (a.startsWith('--seed=')) cfg.seed = Number(a.slice(7));
  }
  if (!Number.isFinite(cfg.n) || cfg.n < 1) cfg.n = 300;
  if (!Number.isFinite(cfg.err) || cfg.err < 0) cfg.err = 0.15;
  if (!Number.isFinite(cfg.seed)) cfg.seed = 12345;
  return cfg;
}

// ---------------------------------------------------------------------------
// OCR confusion model: find cheap substitutions via substitutionCost().
// ---------------------------------------------------------------------------
/**
 * Characters that appear in the confusion map, used to discover cheap partners.
 * Includes the pairs called out in the task (ズ/ス, カ/力, エ/工, ミ/三, ヨ/ョ,
 * 胡椒-family kanji) plus the rest of confusion.ts's groups.
 */
const CONFUSION_ALPHABET =
  'ァアィイゥウェエォオャヤュユョヨッツガカギキグクゲケゴコザサジシズスゼセゾソ' +
  'ダタヅデテドトバハパビヒピブフプベヘペボホポカ力エ工ロ口タ夕ミ三ビピー一丨' +
  '増幹占第祐粘古枯佑椒線織報棚槻城胡古湖故固香辛平看汁计葱五玉瓜爪辰砂沙澱殿' +
  'O0ol1I';

const partnerCache = new Map<string, string[]>();

/** All characters in CONFUSION_ALPHABET that are cheap (cost < 1) to swap with ch. */
function cheapPartners(ch: string): string[] {
  const cached = partnerCache.get(ch);
  if (cached) return cached;
  const out: string[] = [];
  for (const c of CONFUSION_ALPHABET) {
    if (c !== ch && substitutionCost(ch, c) < 1) out.push(c);
  }
  partnerCache.set(ch, out);
  return out;
}

/** Apply exactly one random edit (substitution | deletion | insertion). */
function applyOneEdit(rng: () => number, token: string): string {
  const chars = [...token];
  if (chars.length === 0) return token;
  const kind = randInt(rng, 3);

  if (kind === 0) {
    // Substitution using a cheap confusion pair where one exists in the token.
    const positions: number[] = [];
    for (let i = 0; i < chars.length; i++) {
      if (cheapPartners(chars[i]).length > 0) positions.push(i);
    }
    if (positions.length > 0) {
      const pos = positions[randInt(rng, positions.length)];
      const partners = cheapPartners(chars[pos]);
      chars[pos] = partners[randInt(rng, partners.length)];
      return chars.join('');
    }
    // Fall through to deletion when no cheap pair applies.
  }

  if (kind === 1 || chars.length <= 1) {
    const i = randInt(rng, chars.length);
    chars.splice(i, 1);
    return chars.join('');
  }

  // Insertion of a plausible OCR confusable character.
  const i = randInt(rng, chars.length + 1);
  const c = CONFUSION_ALPHABET[randInt(rng, CONFUSION_ALPHABET.length)];
  chars.splice(i, 0, c);
  return chars.join('');
}

interface Corruption {
  text: string;
  edits: number;
}

/** Corrupt a token with probability `rate`, applying at most 2 edits. */
function corruptToken(rng: () => number, token: string, rate: number): Corruption {
  if (rate <= 0 || rng() >= rate) return { text: token, edits: 0 };
  let out = token;
  let edits = 0;
  const want = rng() < 0.5 ? 1 : 2;
  for (let e = 0; e < want && edits < 2; e++) {
    const next = applyOneEdit(rng, out);
    if (next !== out) {
      out = next;
      edits++;
    }
  }
  return { text: out, edits };
}

// ---------------------------------------------------------------------------
// Corpus loading + weighted sampling (without replacement)
// ---------------------------------------------------------------------------
interface CorpusToken {
  raw: string;
  count: number;
}

const data = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as { top: [string, number][] };
const allTokens: CorpusToken[] = data.top.map(([raw, count]) => ({ raw, count }));

const excludedNoise = allTokens.filter((t) => isLabelNoise(normalize(t.raw)));
// Ingredient-eligible pool: drop label metadata (tax/dates/nutrition/maker/origin).
// These are not ingredients and are intentionally filtered by the pipeline, so
// keeping them would only measure correct noise rejection, not ingredient recall.
const pool = allTokens.filter((t) => {
  const n = normalize(t.raw);
  return n.length >= 2 && !isLabelNoise(n);
});

/** Weighted sampling without replacement (rejection-free cumulative walk). */
function weightedSampleUnique(rng: () => number, tokens: CorpusToken[], k: number): CorpusToken[] {
  const weights = tokens.map((t) => t.count);
  let total = weights.reduce((a, b) => a + b, 0);
  const chosen: CorpusToken[] = [];
  for (let s = 0; s < k && total > 0; s++) {
    let r = rng() * total;
    let idx = -1;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] <= 0) continue;
      if (r < weights[i]) {
        idx = i;
        break;
      }
      r -= weights[i];
    }
    if (idx < 0) {
      idx = weights.findIndex((w) => w > 0);
      if (idx < 0) break;
    }
    chosen.push(tokens[idx]);
    total -= weights[idx];
    weights[idx] = 0;
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Synthetic label generation
// ---------------------------------------------------------------------------
const PRODUCTS = [
  '濃厚とんこつラーメン',
  '北海道バタークッキー',
  '有機野菜スープ',
  'こだわり醤油せんべい',
  'まろやかカレー',
  '極上チョコレート',
  'さくら餅',
  '海鮮せんべい',
  '抹茶ラテ',
  '旨辛ポテトチップス',
];

interface Label {
  product: string;
  tokens: string[];
}

function generateLabels(cfg: Config): Label[] {
  const rng = mulberry32(cfg.seed);
  const labels: Label[] = [];
  for (let i = 0; i < cfg.n; i++) {
    const k = 12 + randInt(rng, 14); // 12..25
    const picks = weightedSampleUnique(rng, pool, k);
    const product = `${PRODUCTS[randInt(rng, PRODUCTS.length)]} ${i + 1}`;
    labels.push({ product, tokens: picks.map((p) => p.raw) });
  }
  return labels;
}

/** Fake full-label OCR text: product line, 原材料名 list, nutrition tail. */
function buildLabelText(product: string, tokens: string[]): string {
  return (
    `${product}\n` +
    `原材料名 ${tokens.join('、')}\n` +
    `栄養成分表示 100g当り 熱量 393kcal たんぱく質 27.9g`
  );
}

// ---------------------------------------------------------------------------
// Evaluation at a given error rate
// ---------------------------------------------------------------------------
interface RateMetrics {
  errorRate: number;
  tokens: number;
  editedTokens: number;
  totalEdits: number;
  verdictRecall: number;
  unknownRate: number;
  unmatchedRate: number;
  recognized: number;
  unknown: number;
  unmatched: number;
  /** Tokens whose verdict came from re-resolving them alone (collapse hid them). */
  resolvedIsolated: number;
  topUnmatched: [string, number][];
  topUnknown: [string, number][];
}

function evaluateRate(cfg: Config, labels: Label[], rate: number): RateMetrics {
  const curated = getCuratedIndex();
  const catalog = getCatalogIndex();
  // Per-rate deterministic stream, independent of the sampling stream.
  const rng = mulberry32((cfg.seed + Math.round(rate * 1e6)) >>> 0);

  let tokens = 0;
  let recognized = 0;
  let unknown = 0;
  let unmatched = 0;
  let editedTokens = 0;
  let totalEdits = 0;
  let resolvedIsolated = 0;
  const unmatchedCounts = new Map<string, number>();
  const unknownCounts = new Map<string, number>();

  // Same layer order as analyzeLayered, for a single token. Used when the
  // label-level pipeline output does not contain the token because collapse()
  // dedupes by entry id (e.g. 小麦 and 小麦粉 both resolve to rule:wheat and
  // only one survives). The user still saw that verdict, so the token counts.
  const resolveIsolated = (text: string) => {
    const fs = analyzeLayered(curated, catalog, text);
    return fs.find((f) => f.match) ?? fs[0] ?? null;
  };

  for (const label of labels) {
    const mutated = label.tokens.map((tok) => {
      const c = corruptToken(rng, tok, rate);
      if (c.edits > 0) {
        editedTokens++;
        totalEdits += c.edits;
      }
      return c.text;
    });

    const text = buildLabelText(label.product, mutated);
    const section = extractIngredientSection(text);
    const findings = analyzeLayered(curated, catalog, section);

    const byNorm = new Map<string, { match: { entry: { status: string; id: string } } | null }>();
    for (const f of findings) byNorm.set(f.normalized, f);

    for (const m of mutated) {
      tokens++;
      let finding = byNorm.get(normalize(m));
      if (!finding) {
        finding = resolveIsolated(m);
        if (finding) resolvedIsolated++;
      }
      if (!finding || !finding.match) {
        unmatched++;
        unmatchedCounts.set(m, (unmatchedCounts.get(m) ?? 0) + 1);
        continue;
      }
      if (finding.match.entry.status === 'unknown') {
        unknown++;
        unknownCounts.set(m, (unknownCounts.get(m) ?? 0) + 1);
        continue;
      }
      recognized++;
    }
  }

  const top = (m: Map<string, number>): [string, number][] =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 25);

  return {
    errorRate: rate,
    tokens,
    editedTokens,
    totalEdits,
    verdictRecall: tokens ? recognized / tokens : 0,
    unknownRate: tokens ? unknown / tokens : 0,
    unmatchedRate: tokens ? unmatched / tokens : 0,
    recognized,
    unknown,
    unmatched,
    resolvedIsolated,
    topUnmatched: top(unmatchedCounts),
    topUnknown: top(unknownCounts),
  };
}

// ---------------------------------------------------------------------------
// High-stakes assertions
// ---------------------------------------------------------------------------
interface Assertion {
  token: string;
  expected: string;
}

const ASSERTIONS: Assertion[] = [
  { token: '豚肉', expected: 'haram' },
  { token: 'ベーコン', expected: 'haram' },
  { token: '焼酎', expected: 'haram' },
  { token: '洋酒', expected: 'haram' },
  { token: '牛肉', expected: 'syubhat' },
  { token: '鶏肉', expected: 'syubhat' },
  { token: 'ラム肉', expected: 'syubhat' },
  { token: 'ゼラチン', expected: 'syubhat' },
  { token: '乳化剤', expected: 'syubhat' },
  { token: 'コチニール色素', expected: 'syubhat' },
  { token: 'みりん', expected: 'syubhat' },
  { token: '料理酒', expected: 'syubhat' },
  { token: '酒粕', expected: 'syubhat' },
  { token: '大豆レシチン', expected: 'halal' },
  { token: 'レシチン', expected: 'syubhat' },
  { token: 'E120', expected: 'syubhat' },
  { token: 'E100', expected: 'halal' },
  { token: '魚肉', expected: 'halal' },
  { token: '食塩', expected: 'halal' },
];

interface AssertionResult extends Assertion {
  actual: string | null;
  pass: boolean;
  entryId: string | null;
  matchedTerm: string | null;
  kind: string | null;
}

function runAssertions(): AssertionResult[] {
  const curated = getCuratedIndex();
  const catalog = getCatalogIndex();
  return ASSERTIONS.map(({ token, expected }) => {
    const findings = analyzeLayered(curated, catalog, token);
    const matched = findings.find((f) => f.match) ?? findings[0];
    const actual = matched?.match?.entry.status ?? null;
    return {
      ...{ token, expected },
      actual,
      pass: actual === expected,
      entryId: matched?.match?.entry.id ?? null,
      matchedTerm: matched?.match?.matchedTerm ?? null,
      kind: matched?.match?.kind ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function pct(x: number): string {
  return (x * 100).toFixed(1).padStart(6);
}

function main(): void {
  const cfg = parseArgs(process.argv.slice(2));
  const labels = generateLabels(cfg);

  // Robustness curve: always include 0, the configured --err, 0.15 and 0.3.
  const rates = [...new Set([0, cfg.err, 0.15, 0.3])].sort((a, b) => a - b);
  const metrics = rates.map((r) => evaluateRate(cfg, labels, r));
  const assertions = runAssertions();

  console.log('=== OFFLINE MATCHING EVAL (synthetic labels) ===');
  console.log(`corpus token rows : ${allTokens.length}`);
  console.log(`  ingredient pool : ${pool.length} (excluded ${excludedNoise.length} label-noise rows)`);
  console.log(`labels            : ${cfg.n}   seed: ${cfg.seed}   primary --err: ${cfg.err}`);
  console.log('');
  console.log('  error | recall | unknown | unmatched | edited tokens');
  console.log('  ------+--------+---------+-----------+--------------');
  for (const m of metrics) {
    console.log(
      `  ${m.errorRate.toFixed(2)}  |${pct(m.verdictRecall)} |${pct(m.unknownRate)}  |${pct(
        m.unmatchedRate
      )}     | ${m.editedTokens}/${m.tokens}`
    );
  }
  console.log(
    `  (per-token re-resolved after collapse dedupe: ${metrics
      .map((m) => `${m.errorRate.toFixed(2)}:${m.resolvedIsolated}`)
      .join('  ')})`
  );
  console.log('');
  console.log('=== HIGH-STAKES ASSERTIONS ===');
  let failed = 0;
  for (const a of assertions) {
    if (!a.pass) failed++;
    console.log(
      `${a.pass ? 'PASS' : 'FAIL'}  ${a.token.padEnd(10)} expected=${a.expected.padEnd(8)} actual=${
        a.actual ?? 'null'
      }${a.entryId ? `  [${a.entryId} / ${a.matchedTerm} / ${a.kind}]` : ''}`
    );
  }
  console.log(`assertions: ${assertions.length - failed}/${assertions.length} passed`);

  const unknownReviews = metrics[metrics.length - 1].topUnknown;
  if (unknownReviews.length) {
    console.log('');
    console.log('=== TOP UNKNOWN-MATCHED TOKENS (highest error rate) ===');
    for (const [t, c] of unknownReviews.slice(0, 10)) console.log(`  ${String(c).padStart(4)}  ${t}`);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    note:
      'Synthetic labels from OFF-JP token frequency. Ingredient-eligible pool excludes rows flagged as label noise by normalize.isLabelNoise(). Per-token attribution uses the label pipeline; tokens hidden by collapse() entry-id dedupe are re-resolved alone. Not real photos.',
    config: cfg,
    corpus: {
      path: CORPUS_PATH,
      tokenRows: allTokens.length,
      ingredientPool: pool.length,
      excludedNoiseRows: excludedNoise.length,
    },
    metrics,
    assertions,
    assertionsPassed: assertions.length - failed,
    assertionsTotal: assertions.length,
  };
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log('');
  console.log(`wrote ${OUT_PATH}`);
}

main();
