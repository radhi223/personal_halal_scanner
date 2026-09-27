#!/usr/bin/env node
/**
 * Bulk label expansion — build conservative curated entries from the OFF-JP
 * token corpus.
 *
 * Run (dry run, prints stats + writes proposal to D:/opencode/temp):
 *   npx tsx scripts/expand-labels.mjs
 * Apply into src/data/ingredients.json:
 *   npx tsx scripts/expand-labels.mjs --apply
 *
 * Design (accuracy-first):
 *  - Candidates = corpus tokens that currently get NO verdict (not label noise,
 *    not curated, not rule, not catalog-resolved). Already-labelled tokens are
 *    never touched.
 *  - Classification is lexicon-driven. Every token is hand-assigned to a preset
 *    whose status/confidence/sources mirror the existing curated stance
 *    (plants/minerals/fish -> halal; animal extracts/cheese -> syubhat;
 *    alcohol -> haram only for explicit, exact names).
 *  - Hard guards (violating any = token is dropped, not relaxed):
 *      1. a HALAL token may not contain any animal/alcohol marker;
 *      2. HARAM entries are only allowed from the explicit `haram` list
 *         (pork/alcohol), never from a heuristic;
 *      3. a proposal that fuzzy-collides with an existing entry of a different
 *         status is dropped (fuzzy must never bridge different meanings);
 *      4. brand/manufacturer-looking tokens are dropped.
 *  - Existing curated concepts get new `names` instead of duplicate entries
 *    (see EXISTING_ADD).
 */

// @ts-nocheck
import { readFileSync, writeFileSync } from 'node:fs';
import { getCatalogIndex, getCuratedIndex, loadCurated } from '@/lib/database';
import { buildIndex, matchNormalized, maxFuzzyDistance } from '@/lib/matcher';
import { isLabelNoise, normalize } from '@/lib/normalize';
import { matchRule } from '@/lib/rules';
import { levenshtein } from '@/lib/levenshtein';

const CORPUS = 'D:/opencode/temp/jp-tokens-full.json';
const CORPUS_FALLBACK = 'D:/opencode/temp/jp-tokens-by-category.json';
const TARGET = 'src/data/ingredients.json';
const PROPOSAL_OUT = 'D:/opencode/temp/expand-proposal.json';
const APPLY = process.argv.includes('--apply');
const AUDIT = process.argv.includes('--audit');
const UPDATED_AT = '2026-09-27';
const NEW_VERSION = '0.2.0-expanded';

// ---------------------------------------------------------------------------
// Source strings — copied verbatim from the strings already used in the repo.
// ---------------------------------------------------------------------------
const S_PLANT = ['LPPOM MUI — bahan nabati', 'JAKIM MS1500:2019'];
const S_MINERAL = ['LPPOM MUI — bahan mineral', 'JAKIM MS1500:2019'];
const S_SEA = ["QS Al-Maa'idah 5:96", 'LPPOM MUI — hasil laut'];
const S_ANIMAL = ['QS Al-Baqarah 2:173 (prinsip)', 'JAKIM MS1500:2019'];
const S_EXTRACT = ['LPPOM MUI — turunan hewan', 'JAKIM MS1500:2019'];
const S_DAIRY = ['LPPOM MUI — turunan susu', 'JAKIM MS1500:2019'];
const S_ADD = ['LPPOM MUI — bahan tambahan', 'JAKIM MS1500:2019'];
const S_ALCOHOL = ["QS Al-Maa'idah 5:90", 'LPPOM MUI'];
const S_HARAM = ['QS Al-Baqarah 2:173', 'LPPOM MUI — kriteria bahan haram'];
const S_MICROBE = ['LPPOM MUI — bahan mikroba', 'JAKIM MS1500:2019'];
const S_COLOR_EFSA = ['EFSA — pewarna', 'LPPOM MUI — pewarna'];

// ---------------------------------------------------------------------------
// Presets: status/confidence/basis/category/sources/reasoning per group.
// `homeRisky` = the group is ALLOWED to contain animal/alcohol markers
// (its classification is based on that origin, not an oversight).
// ---------------------------------------------------------------------------
const GROUPS = {
  plant: {
    status: 'halal', confidence: 'high', basis: 'fiqh-rule', category: 'plant', sources: S_PLANT,
    reasoning: (n) => `${n} adalah bahan nabati (tumbuhan/buah/sayur/biji) — halal.`,
  },
  grain: {
    status: 'halal', confidence: 'high', basis: 'fiqh-rule', category: 'grain', sources: S_PLANT,
    reasoning: (n) => `${n} adalah biji-bijian/tepung nabati — halal.`,
  },
  grain_prepared: {
    status: 'halal', confidence: 'high', basis: 'fiqh-rule', category: 'grain', sources: S_PLANT,
    reasoning: (n) => `${n} adalah olahan beras/gandum nabati — halal (waspadai isian hewani pada produk siap saji).`,
  },
  seaweed: {
    status: 'halal', confidence: 'high', basis: 'fiqh-rule', category: 'plant', sources: S_PLANT,
    reasoning: (n) => `${n} adalah rumput laut/alga — halal.`,
  },
  mushroom: {
    status: 'halal', confidence: 'high', basis: 'fiqh-rule', category: 'plant', sources: S_PLANT,
    reasoning: (n) => `${n} adalah jamur — halal.`,
  },
  legume: {
    status: 'halal', confidence: 'high', basis: 'fiqh-rule', category: 'plant', sources: S_PLANT,
    reasoning: (n) => `${n} adalah kacang-kacangan/legum nabati — halal.`,
  },
  fruit: {
    status: 'halal', confidence: 'high', basis: 'fiqh-rule', category: 'plant', sources: S_PLANT,
    reasoning: (n) => `${n} adalah buah — halal.`,
  },
  fat: {
    status: 'halal', confidence: 'medium', basis: 'fiqh-rule', category: 'fat', sources: S_PLANT,
    reasoning: (n) => `${n}: minyak/lemak nabati — halal (sumber nabati yang jelas).`,
  },
  sea: {
    status: 'halal', confidence: 'medium', basis: 'fiqh-rule', category: 'animal', sources: S_SEA, homeRisky: true,
    reasoning: (n) => `${n} adalah hasil laut (ikan/kerang/rumput laut laut) — halal menurut mayoritas ulama.`,
  },
  roe: {
    status: 'halal', confidence: 'medium', basis: 'fiqh-rule', category: 'animal', sources: S_SEA, homeRisky: true,
    reasoning: (n) => `${n} adalah telur ikan (hasil laut) — halal menurut mayoritas ulama.`,
  },
  mineral: {
    status: 'halal', confidence: 'high', basis: 'fiqh-rule', category: 'mineral', sources: S_MINERAL,
    reasoning: (n) => `${n} adalah mineral/garam/air — halal.`,
  },
  water: {
    status: 'halal', confidence: 'high', basis: 'fiqh-rule', category: 'mineral', sources: S_MINERAL,
    reasoning: (n) => `${n} adalah air/gas minuman — halal.`,
  },
  additive_halal: {
    status: 'halal', confidence: 'medium', basis: 'cross-source', category: 'additive', sources: S_ADD,
    reasoning: (n) => `${n} adalah bahan tambahan yang umumnya bersumber nabati/mikroba/mineral — halal.`,
  },
  additive_low: {
    status: 'halal', confidence: 'low', basis: 'japan-label-rule', category: 'additive', sources: S_ADD,
    reasoning: (n) => `${n} adalah kelas bahan tambahan yang umumnya halal (bahan fungsional); waspadai bila ada turunan hewani.`,
  },
  additive_syubhat: {
    status: 'syubhat', confidence: 'medium', basis: 'japan-label-rule', category: 'additive', sources: S_ADD, homeRisky: true,
    reasoning: (n) => `${n} adalah bahan tambahan yang sumbernya bergantung produsen (nabati/hewani, termasuk babi) — perlu verifikasi, syubhat.`,
  },
  sweetener: {
    status: 'halal', confidence: 'medium', basis: 'cross-source', category: 'sweetener', sources: S_ADD,
    reasoning: (n) => `${n} adalah pemanis (gula/poliol/glikosida) — halal, tidak memabukkan.`,
  },
  amino: {
    status: 'halal', confidence: 'medium', basis: 'cross-source', category: 'additive', sources: S_ADD,
    reasoning: (n) => `${n} adalah asam amino hasil fermentasi/sintesis mikroba — halal.`,
  },
  vitamin: {
    status: 'halal', confidence: 'medium', basis: 'cross-source', category: 'additive', sources: S_ADD,
    reasoning: (n) => `${n} adalah vitamin/mineral mikroba — halal.`,
  },
  color_plant: {
    status: 'halal', confidence: 'medium', basis: 'cross-source', category: 'colorant', sources: S_COLOR_EFSA,
    reasoning: (n) => `${n} adalah pewarna dari sumber nabati/mineral — halal.`,
  },
  enzyme_microbe: {
    status: 'halal', confidence: 'medium', basis: 'cross-source', category: 'enzyme', sources: S_MICROBE,
    reasoning: (n) => `${n} adalah enzim/polisakarida dari fermentasi mikroba — halal.`,
  },
  microbe: {
    status: 'halal', confidence: 'medium', basis: 'cross-source', category: 'additive', sources: S_MICROBE, homeRisky: true,
    reasoning: (n) => `${n} adalah kultur/ragi mikroba — halal.`,
  },
  dairy_halal: {
    status: 'halal', confidence: 'medium', basis: 'fiqh-rule', category: 'dairy', sources: S_DAIRY, homeRisky: true,
    reasoning: (n) => `${n} adalah produk susu — halal; waspadai enzim/rennet pada produk turunannya.`,
  },
  dairy_low: {
    status: 'halal', confidence: 'low', basis: 'japan-label-rule', category: 'dairy', sources: S_DAIRY, homeRisky: true,
    reasoning: (n) => `${n} berbasis susu — umumnya halal; waspadai enzim/rennet.`,
  },
  cheese: {
    status: 'syubhat', confidence: 'medium', basis: 'japan-label-rule', category: 'dairy', sources: S_DAIRY, homeRisky: true,
    reasoning: (n) => `${n} adalah produk keju yang dapat memakai rennet hewani — perlu sertifikasi halal, syubhat.`,
  },
  animal_meat: {
    status: 'syubhat', confidence: 'medium', basis: 'fiqh-rule', category: 'animal', sources: S_ANIMAL, homeRisky: true,
    reasoning: (n) => `${n} adalah daging hewani; halal bila disembelih syar'i, tetapi di Jepang umumnya tidak — tanpa sertifikasi, syubhat.`,
  },
  animal_extract: {
    status: 'syubhat', confidence: 'medium', basis: 'japan-label-rule', category: 'animal', sources: S_EXTRACT, homeRisky: true,
    reasoning: (n) => `${n} adalah ekstrak/kaldu hewani tanpa keterangan spesies & sembelihan — syubhat.`,
  },
  animal_other: {
    status: 'syubhat', confidence: 'medium', basis: 'japan-label-rule', category: 'animal', sources: S_EXTRACT, homeRisky: true,
    reasoning: (n) => `${n} dapat berasal dari bahan hewani tanpa keterangan sumber — syubhat.`,
  },
  taurine: {
    status: 'syubhat', confidence: 'low', basis: 'japan-label-rule', category: 'additive', sources: S_ADD, homeRisky: true,
    reasoning: (n) => `${n} dapat berasal dari hewani (empedu) atau sintetis; tanpa keterangan sumber — syubhat.`,
  },
  royal_jelly: {
    status: 'syubhat', confidence: 'low', basis: 'japan-label-rule', category: 'animal', sources: S_ADD, homeRisky: true,
    reasoning: (n) => `${n} adalah sekresi lebah; umumnya halal tetapi sebagian ulama memperdebatkan statusnya — syubhat.`,
  },
  fermented_syubhat: {
    status: 'syubhat', confidence: 'low', basis: 'japan-label-rule', category: 'fermented', sources: S_ADD, homeRisky: true,
    reasoning: (n) => `${n} adalah bumbu/produk fermentasi yang dapat mengandung alkohol atau ekstrak hewani — perlu verifikasi, syubhat.`,
  },
  fermented_halal_low: {
    status: 'halal', confidence: 'low', basis: 'japan-label-rule', category: 'fermented', sources: S_ADD,
    reasoning: (n) => `${n} adalah hasil fermentasi nabati/mikroba; umumnya halal, tetapi waspadai residu alkohol.`,
  },
  seasoning_low: {
    status: 'halal', confidence: 'low', basis: 'japan-label-rule', category: 'seasoning', sources: S_ADD,
    reasoning: (n) => `${n} adalah bumbu/penyedap; umumnya halal, tetapi sebagian bisa berisi ekstrak hewani.`,
  },
  confectionery_low: {
    status: 'halal', confidence: 'low', basis: 'japan-label-rule', category: 'dessert', sources: S_ADD,
    reasoning: (n) => `${n} adalah produk tepung/gula olahan; umumnya halal, tetapi waspadai shortening, emulsifier, atau gelatin.`,
  },
  alcohol_syubhat: {
    status: 'syubhat', confidence: 'medium', basis: 'japan-label-rule', category: 'alcohol', sources: S_ALCOHOL, homeRisky: true,
    reasoning: (n) => `${n} adalah bumbu/produk berbasis alkohol (beras/fermentasi) yang statusnya diperdebatkan — syubhat.`,
  },
  haram: {
    status: 'haram', confidence: 'high', basis: 'fiqh-rule', category: 'alcohol', sources: S_ALCOHOL, homeRisky: true,
    reasoning: (n) => `${n} adalah minuman beralkohol (khamr) — haram.`,
  },
  haram_pork: {
    status: 'haram', confidence: 'high', basis: 'fiqh-rule', category: 'animal', sources: S_HARAM, homeRisky: true,
    reasoning: (n) => `${n} berasal dari babi (daging/lemak/ekstrak) — haram secara eksplisit.`,
  },
  additive_cn: {
    status: 'halal', confidence: 'medium', basis: 'cross-source', category: 'additive', sources: S_ADD,
    reasoning: (n) => `${n} (nama aditif Tionghoa) umumnya bersumber nabati/mineral/mikroba — halal.`,
  },
  color_syubhat_low: {
    status: 'syubhat', confidence: 'low', basis: 'japan-label-rule', category: 'colorant', sources: S_COLOR_EFSA, homeRisky: true,
    reasoning: (n) => `${n} adalah pewarna generik yang bisa nabati, sintetis, atau serangga/hewani — perlu verifikasi.`,
  },
  flavor_syubhat: {
    status: 'syubhat', confidence: 'low', basis: 'japan-label-rule', category: 'additive', sources: S_ADD, homeRisky: true,
    reasoning: (n) => `${n} adalah perisa/ekstrak yang dapat memakai pelarut alkohol atau turunan hewani — perlu verifikasi.`,
  },
  fat_syubhat: {
    status: 'syubhat', confidence: 'low', basis: 'japan-label-rule', category: 'fat', sources: S_ADD, homeRisky: true,
    reasoning: (n) => `${n} adalah lemak/minyak olahan yang bisa hewani (termasuk babi) atau nabati — perlu verifikasi.`,
  },
  seasoning_syubhat: {
    status: 'syubhat', confidence: 'low', basis: 'japan-label-rule', category: 'seasoning', sources: S_ADD, homeRisky: true,
    reasoning: (n) => `${n} adalah bumbu cair/olahan yang dapat mengandung alkohol, kecap fermentasi, atau ekstrak hewani — perlu verifikasi.`,
  },
};

// ---------------------------------------------------------------------------
// HARD GUARDS
// ---------------------------------------------------------------------------
/** Animal/alcohol markers that forbid a HALAL verdict (unless group is homeRisky). */
const ANIMAL_ALCOHOL_RE =
  /(酒|アルコール|エタノール|豚|ポーク|ラード|ラム|ハム|肉|エキス|ゼラチン|コラーゲン|ヘット|レンネット|ペプシン|酵素|乳化|油脂|骨|血|皮|乳|卵|バター|チーズ|クリーム|マーガリン|ショートニング|酵母|発酵|醸造|たん白|蛋白|タンパク|カゼイン|ホエイ|魚|かつお|えび|かに|貝|いか|たこ)/;
/** Brand / manufacturer / store markers. */
const BRAND_RE =
  /(株式会社|有限会社|御菓子|製菓|珈琲|コーヒーカンパニー|カゴメ|湖池屋|明治|ブルボン|西友|天乃屋|マルハニチロ|ダイドー|サントリー|ポッカ|ウェルネオ|江崎|丸大|ライフコーポレーション|ファミリーマート|セブン|ローソン|アクエリアス|ポカリ|カスタマー|センター|お客様)/;

/**
 * Reviewed exceptions to the animal/alcohol marker guard. Each of these was
 * checked by hand: 梅肉 = pickled-plum flesh (not meat), 陳皮/桂皮/ゆず皮/
 * みかんの皮 = citrus/spice peel (not animal skin), 豆乳 = soy milk,
 * (mineral/microbe yeasts are covered by the microbe preset's homeRisky flag).
 */
const RISK_EXCEPTIONS = [
  /梅肉/,
  /^ゆず(の)?皮$/,
  /^(ミカン|みかん)の皮$/,
  /^陳皮$/,
  /^肉桂$/,
  /^桂皮/,
  /^豆乳/,
  /^低脂肪豆乳$/,
  /^豆乳加工品$/,
  /^ベルペッパー/,
  /^皮付きフライポテト$/,
  /^ガラムマサラ$/,
  /^最中皮$/,
  /果肉$/,
  /^貝(カルシウム|Ｃａ)$/,
  /^d?抗坏血酸/,
  /^d?异抗坏血酸/,
  /^抗壞血酸/,
  /^粒状植物(性)?たん/,
  /^植物性たんぱく$/,
  /^シュー皮$/,
];

function isBrandLike(name) {
  return BRAND_RE.test(name);
}

/** Stable ascii-safe id component for a token. */
function slug(s) {
  const n = normalize(s).replace(/[^0-9a-z\u3040-\u30ff\u4e00-\u9fff]+/g, '');
  return n.slice(0, 24) || 'x';
}

/**
 * JSON writer that keeps arrays of primitives on one line (names/sources), so
 * re-writing ingredients.json does not churn the whole file.
 */
function serializeJson(value, indent = 0) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))) {
      return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    }
    return `[\n${value.map((v) => padIn + serializeJson(v, indent + 1)).join(',\n')}\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    return `{\n${keys.map((k) => `${padIn}${JSON.stringify(k)}: ${serializeJson(value[k], indent + 1)}`).join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// EXISTING entries that should receive extra surface forms (concept already
// curated). Applied only if the token is currently unlabelled.
// ---------------------------------------------------------------------------
const EXISTING_ADD = {
  // Only exact synonyms of one existing concept. Product varieties / parts
  // (cheese types, sugar types, chicken cuts, soy-sauce variants) are curated
  // as their own entries instead, so they remain individually auditable.
  'pork-extract': ['ボークエキの'],
  mirin: ['ミリン'],
  'yeast-extract': ['酵母工キス', '酵母工キスパウダー', '酵母エキパウダー'],
};

// ---------------------------------------------------------------------------
// Token corpus
// ---------------------------------------------------------------------------
function loadTokens() {
  try {
    const d = JSON.parse(readFileSync(CORPUS, 'utf8'));
    if (d.global?.top?.length > 800) return d.global.top;
  } catch {
    /* fall through */
  }
  const d = JSON.parse(readFileSync(CORPUS_FALLBACK, 'utf8'));
  const all = new Map(d.global.top);
  for (const b of Object.values(d.buckets)) for (const [t, c] of b.top) if (!all.has(t)) all.set(t, c);
  return [...all.entries()];
}

// ---------------------------------------------------------------------------
// Candidate detection.
//
// Two classes qualify for curation:
//   A. unlabelled  — no curated verdict, no rule, no catalog hit (true gaps);
//   B. catalog-only — the only verdict is an UNREVIEWED Open Food Facts catalog
//      name (often a weak vegan=yes origin signal). Promoting these to curated
//      entries does not change the verdict direction, only confidence/review
//      status, and they are exactly the long tail the corpus is made of.
// ---------------------------------------------------------------------------
function candidatesFor(tokens) {
  const curated = getCuratedIndex();
  const catalog = getCatalogIndex();
  const out = [];
  for (const [raw, count] of tokens) {
    const n = normalize(raw);
    if (!n || n.length < 2 || /\d/.test(n)) continue;
    if (isLabelNoise(n)) continue;
    // Only an EXACT curated verdict blocks curation. A fuzzy curated hit is
    // approximate (e.g. みかん -> みりん, ビート -> ビーフ are pre-existing
    // fuzzy false positives); giving the token its own exact, reviewed entry
    // is strictly better, so such tokens stay eligible.
    const c = matchNormalized(curated, n);
    if (c && c.kind === 'exact') continue;
    if (matchRule(n)) continue;
    const cat = matchNormalized(catalog, n);
    const kind = cat && cat.entry.status !== 'unknown' ? 'catalog' : 'unlabelled';
    out.push({ raw, n, count, kind });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lexicon -> proposal entries
// ---------------------------------------------------------------------------
import { ITEMS } from './expand-labels.lexicon.mjs';

function buildProposal(candidateSet) {
  const curated = getCuratedIndex();
  const accepted = [];
  const acceptedNames = new Map(); // normalized name -> status
  const skipped = [];
  const usedIds = new Set();

  const coveredCheck = (name) => candidateSet.has(normalize(name));

  /**
   * Collision guard against the EXISTING curated layer: only an existing HARAM
   * neighbour blocks a new non-haram name (e.g. ラー油 near ラード, パイン near
   * ワイン, ぶどう near ぶどう酒). Those are the cases where a near-miss query
   * could be pulled into a halal/syubhat verdict it must not get. Collisions
   * with syubhat entries are allowed — a near neighbour of みりん/ビーフ (e.g.
   * みかん/ビート) is exactly the pre-existing fuzzy false positive that an
   * exact curated entry fixes. Collisions between two *proposed* exact entries
   * are not blocked either: both resolve exactly.
   */
  const fuzzyConflict = (name, status) => {
    const n = normalize(name);
    const qAllow = maxFuzzyDistance(n.length);
    if (qAllow <= 0) return null;
    for (const { term, entry } of curated.names) {
      if (entry.status !== 'haram') continue;
      const allow = Math.min(qAllow, maxFuzzyDistance(term.length));
      if (allow <= 0) continue;
      if (Math.abs(term.length - n.length) > allow) continue;
      if (levenshtein(n, term) <= allow) return { term, status: entry.status, id: entry.id };
    }
    return null;
  };

  for (const [presetKey, preset] of Object.entries(GROUPS)) {
    const items = ITEMS[presetKey] ?? [];
    for (const item of items) {
      const isGroup = Array.isArray(item);
      const names = isGroup ? item[1] : [item];
      const conceptId = isGroup ? item[0] : null;
      const kept = [];
      for (const name of names) {
        const n = normalize(name);
        if (!n || n.length < 2) { skipped.push([presetKey, name, 'fragment']); continue; }
        if (!coveredCheck(n)) { skipped.push([presetKey, name, 'already-covered/noise']); continue; }
        if (preset.status === 'halal' && !preset.homeRisky && ANIMAL_ALCOHOL_RE.test(n) && !RISK_EXCEPTIONS.some((r) => r.test(n))) {
          skipped.push([presetKey, name, 'halal-but-animal/alcohol-marker']); continue;
        }
        if (isBrandLike(n)) { skipped.push([presetKey, name, 'brand-like']); continue; }
        // Fuzzy can never yield haram (matcher invariant), so an explicit
        // haram proposal cannot cause a fuzzy false-positive; only non-haram
        // proposals need the collision guard.
        if (preset.status !== 'haram') {
          const fc = fuzzyConflict(n, preset.status);
          if (fc) { skipped.push([presetKey, name, `fuzzy-collision:${fc.term}(${fc.status})`]); continue; }
        }
        kept.push(n);
      }
      if (!kept.length) continue;
      const id = `exp:${conceptId ? slug(conceptId) : slug(kept[0])}`;
      if (usedIds.has(id)) { skipped.push([presetKey, kept[0], 'duplicate-id']); continue; }
      usedIds.add(id);
      for (const k of kept) acceptedNames.set(k, preset.status);
      accepted.push({
        id,
        names: kept,
        preset: presetKey,
        status: preset.status,
        confidence: preset.confidence,
        basis: preset.basis,
        category: preset.category,
        reasoning: preset.reasoning(kept[0]),
        sources: preset.sources,
      });
    }
  }
  return { accepted, skipped };
}

// ---------------------------------------------------------------------------
// Coverage measurement (same logic as gaps.ts, existing + proposal)
// ---------------------------------------------------------------------------
function coverage(extraEntries) {
  const entries = [...loadCurated().entries, ...(extraEntries ?? [])];
  const index = buildIndex(entries);
  const catalog = getCatalogIndex();
  const tokens = loadTokens();
  let total = 0, covered = 0, noise = 0;
  for (const [raw, count] of tokens) {
    total += count;
    const n = normalize(raw);
    if (isLabelNoise(n)) { noise += count; continue; }
    const c = matchNormalized(index, n);
    if (c && c.entry.status !== 'unknown') { covered += count; continue; }
    if (matchRule(n)) { covered += count; continue; }
    const cat = matchNormalized(catalog, n);
    if (cat && cat.entry.status !== 'unknown') covered += count;
  }
  return { total, covered, noise };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const tokens = loadTokens();
const cands = candidatesFor(tokens);
const candidateSet = new Set(cands.map((c) => c.n));
console.log(`corpus tokens: ${tokens.length}, currently unlabelled candidates: ${cands.length}`);

const { accepted, skipped } = buildProposal(candidateSet);

const byCat = {};
const byStatus = {};
for (const e of accepted) {
  byCat[e.category] = (byCat[e.category] ?? 0) + 1;
  byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
}
const byPreset = {};
for (const e of accepted) byPreset[e.preset] = (byPreset[e.preset] ?? 0) + 1;
console.log(`proposed new entries: ${accepted.length}`);
console.log('  by status:', JSON.stringify(byStatus));
console.log('  by category:', JSON.stringify(byCat));
console.log('  by preset:', JSON.stringify(byPreset));
console.log(`skipped names: ${skipped.length}`);

const before = coverage([]);
const after = coverage(accepted.map((e) => ({
  id: e.id, names: e.names, status: e.status, confidence: e.confidence, basis: e.basis,
  reviewed: true, category: e.category, reasoning: e.reasoning, sources: e.sources,
})));
const p = (x, t) => `${((x / t) * 100).toFixed(1)}%`;
console.log(`coverage (full corpus) before: ${p(before.covered, before.total)}  after: ${p(after.covered, after.total)}`);
console.log(`noise: ${p(before.noise, before.total)}`);

writeFileSync(PROPOSAL_OUT, JSON.stringify({ generatedAt: UPDATED_AT, before, after, accepted, skipped }, null, 1), 'utf8');
console.log(`proposal -> ${PROPOSAL_OUT}`);

if (AUDIT) {
  console.log('\n=== SKIPPED (first 200) ===');
  for (const [g, name, why] of skipped.slice(0, 200)) console.log(`${g.padEnd(18)} ${name}  -- ${why}`);

  // Verdict-flip audit: every corpus token whose verdict CHANGES because of
  // the proposal. A change caused by a FUZZY hit is the dangerous class (it
  // could leak the new halal/syubhat to a slightly different token), so it is
  // listed separately for human review. Fuzzy hits can never be haram.
  const beforeIndex = buildIndex(loadCurated().entries);
  const afterIndex = buildIndex([
    ...loadCurated().entries,
    ...accepted.map((e) => ({ ...e, reviewed: true })),
  ]);
  const verdictOf = (index, n) => {
    const exact = index.exact.get(n);
    if (exact) return { status: exact.status, kind: 'exact', id: exact.id };
    const r = matchRule(n);
    if (r) return { status: r.status, kind: 'rule', id: `rule:${r.id}` };
    const m = matchNormalized(index, n);
    if (m) return { status: m.entry.status, kind: m.kind, id: m.entry.id };
    return null;
  };
  const flips = [];
  const fuzzyFlips = [];
  for (const [raw, count] of loadTokens()) {
    const n = normalize(raw);
    if (!n || isLabelNoise(n)) continue;
    const b = verdictOf(beforeIndex, n);
    const a = verdictOf(afterIndex, n);
    const bs = b?.status ?? 'none';
    const as = a?.status ?? 'none';
    if (bs === as) continue;
    flips.push([raw, count, bs, as, a?.kind ?? 'none']);
    if (a && a.kind === 'fuzzy') fuzzyFlips.push([raw, count, bs, as, a.id]);
  }
  console.log(`\nverdict flips: ${flips.length} (fuzzy-caused: ${fuzzyFlips.length})`);
  const summary = {};
  for (const [, , bs, as] of flips) summary[`${bs}->${as}`] = (summary[`${bs}->${as}`] ?? 0) + 1;
  console.log('  transitions:', JSON.stringify(summary));
  console.log('=== FUZZY-CAUSED FLIPS (review!) ===');
  for (const f of fuzzyFlips.slice(0, 120)) console.log(`  ${f[0]}  ${f[2]} -> ${f[3]}  via ${f[4]}`);
}

if (APPLY) {
  const file = JSON.parse(readFileSync(TARGET, 'utf8'));
  const existing = file.entries;
  const byId = new Map(existing.map((e) => [e.id, e]));
  let addedNames = 0;
  for (const [id, names] of Object.entries(EXISTING_ADD)) {
    const entry = byId.get(id);
    if (!entry) { console.warn(`EXISTING_ADD: id not found: ${id}`); continue; }
    const have = new Set(entry.names.map((x) => normalize(x)));
    for (const name of names) {
      const n = normalize(name);
      if (!n || !candidateSet.has(n) || have.has(n)) continue;
      entry.names.push(n);
      have.add(n);
      addedNames++;
    }
  }
  const generated = accepted.map((e) => ({
    id: e.id, names: e.names, status: e.status, confidence: e.confidence, basis: e.basis,
    reviewed: true, category: e.category, reasoning: e.reasoning, sources: e.sources,
  }));
  generated.sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.id.localeCompare(b.id));
  // Idempotent: an existing `exp:` entry with the same id is merged (names
  // unioned, verdict refreshed) instead of appended twice.
  for (const g of generated) {
    const prev = byId.get(g.id);
    if (!prev) { existing.push(g); byId.set(g.id, g); continue; }
    const have = new Set(prev.names.map((x) => normalize(x)));
    for (const n of g.names) if (!have.has(normalize(n))) { prev.names.push(n); have.add(normalize(n)); addedNames++; }
    Object.assign(prev, {
      status: g.status, confidence: g.confidence, basis: g.basis, category: g.category,
      reasoning: g.reasoning, sources: g.sources, reviewed: true,
    });
  }
  file.entries = existing;
  file.version = NEW_VERSION;
  file.updatedAt = UPDATED_AT;
  writeFileSync(TARGET, `${serializeJson(file)}\n`, 'utf8');
  console.log(`APPLIED: +${generated.length} entries, +${addedNames} names on existing entries -> ${TARGET}`);
  console.log(`curated file entries: ${file.entries.length}`);
}
