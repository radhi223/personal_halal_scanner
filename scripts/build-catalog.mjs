/**
 * Build the unreviewed OFF name catalog.
 *
 * Two open-data sources (no rate-limited search API involved):
 *   1. OFF ingredient taxonomy (static file) -> structured ja/en/E-number names.
 *   2. JP product labels -> Japanese surface forms produced by
 *      scripts/harvest-off-jp.py from the OFF bulk export.
 *
 * Output: src/data/catalog.json (compact; statuses default to "unknown" at load)
 *
 * Pipeline:
 *   # one-time, downloads ~1.2 GB static export, streams it, writes a token cache
 *   python scripts/harvest-off-jp.py --csv <products.csv.gz> --out <tokens.json>
 *   node scripts/build-catalog.mjs
 *
 * NOTE: do NOT reintroduce OFF /search loops here. Their docs cap search at
 * ~10 req/min and bulk looping gets the IP soft-banned. Use the static export.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const TAXONOMY_CACHE = 'C:/Users/Radhi/AppData/Local/Temp/opencode/off-ingredients.json';
const TOKEN_CACHE = 'C:/Users/Radhi/AppData/Local/Temp/opencode/off-jp-tokens.json';
const OUT = resolve('src/data/catalog.json');

const JP_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
const E_RE = /^E\d{3,4}[a-z]?$/i;

/** Minimal normalize (mirror of src/lib/normalize.ts) for dedup keys. */
function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[・、。，．！？「」『』【】（）〔〕［］｛｝]+/g, '')
    .replace(/[.,:;!?'"`~^*_\-–—/\\|+=<>@#$%&]+/g, '');
}

function loadJson(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} missing: ${path}\nSee the pipeline notes at the top of this file.`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function taxonomyEntries(tax) {
  const entries = [];
  for (const [rawId, e] of Object.entries(tax)) {
    const names = [];
    const n = e.name || {};
    const ja = n.ja;
    // OFF stores e_number as an object ({"en":"404"}), not a string. String()
    // on it produced the literal "[object Object]" — 633 catalog entries carried
    // that as a name AND as their eNumber (data-quality bug found 2026-09-27).
    const eNum = e.e_number?.en ? `E${String(e.e_number.en).replace(/^e/i, '')}` : null;
    if (ja && JP_RE.test(ja)) names.push(ja);
    if (ja && E_RE.test(ja.trim())) names.push(ja.trim());
    if (eNum) names.push(eNum);
    if (n.en) names.push(n.en);

    const seen = new Set();
    const clean = [];
    for (const name of names) {
      const k = norm(name);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      clean.push(name);
    }
    if (!clean.length) continue;

    entries.push({
      id: rawId.replace(/^[a-z]{2}:/, ''),
      names: clean,
      src: 'tax',
      ...(eNum ? { eNumber: eNum } : {}),
      // Open Food Facts origin signals (weak; not a halal verdict).
      ...(e.vegan && e.vegan.en ? { vegan: e.vegan.en } : {}),
      ...(e.vegetarian && e.vegetarian.en ? { vegetarian: e.vegetarian.en } : {}),
      ...(e.from_palm_oil && e.from_palm_oil.en ? { palmOil: e.from_palm_oil.en } : {}),
    });
  }
  return entries;
}

function main() {
  console.log('Loading OFF taxonomy...');
  const tax = loadJson(TAXONOMY_CACHE, 'Taxonomy cache');
  const taxEntries = taxonomyEntries(tax);
  console.log(`  taxonomy entries with names: ${taxEntries.length}`);

  console.log('Loading JP label token cache...');
  const tokenCache = loadJson(TOKEN_CACHE, 'JP token cache');
  const jpTokens = Object.entries(tokenCache.tokens || {});
  console.log(`  harvested JP tokens: ${jpTokens.length}`);

  const seen = new Set();
  for (const e of taxEntries) for (const n of e.names) seen.add(norm(n));

  const jpEntries = [];
  let idx = 0;
  for (const [k, raw] of jpTokens) {
    if (seen.has(k)) continue;
    seen.add(k);
    jpEntries.push({ id: `jp-${idx++}`, names: [raw], src: 'jp' });
  }
  console.log(`  new JP tokens: ${jpEntries.length}`);

  const entries = [...taxEntries, ...jpEntries];
  const out = {
    version: `off-${new Date().toISOString().slice(0, 10)}`,
    updatedAt: new Date().toISOString(),
    entries,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  const bytes = readFileSync(OUT).length;
  console.log(`\nWrote ${OUT}`);
  console.log(`  entries: ${entries.length} (${taxEntries.length} taxonomy + ${jpEntries.length} JP)`);
  console.log(`  size: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

main();
