/**
 * Build the unreviewed OFF name catalog.
 *
 * HERMETIC pipeline (audited + fixed 2026-09-29): this script reads ONLY the
 * pinned inputs vendored in scripts/data/. Both files are hashed and the hash
 * is asserted against a constant below — if the pinned data changes, the build
 * aborts instead of silently producing a different catalog. No network, no
 * %TEMP% caches, no new Date() (version/updatedAt are pinned), so the output is
 * byte-reproducible.
 *
 *   1. OFF ingredient taxonomy (static file) -> structured ja/en/E-number names.
 *   2. JP product labels -> Japanese surface forms produced by
 *      scripts/harvest-off-jp.py from the OFF bulk export.
 *
 * Pinned inputs were generated from:
 *   - %TEMP%/off-ingredients.json              (OFF taxonomy, trimmed)
 *   - %TEMP%/off-jp-tokens.json                (harvest token cache)
 *   - D:/opencode/temp/off-products.csv.gz     (bulk export; sha256 in meta)
 *
 * Output: src/data/catalog.json (compact; statuses default to "unknown" at load)
 *
 * Usage:
 *   node scripts/build-catalog.mjs           # write src/data/catalog.json
 *   node scripts/build-catalog.mjs --check   # rebuild to temp, byte-compare, exit 1 on diff
 *
 * NOTE: do NOT reintroduce OFF /search loops here. Their docs cap search at
 * ~10 req/min and bulk looping gets the IP soft-banned. Use the static export.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PINNED_TAX = resolve(HERE, 'data/off-ingredients.pinned.json');
const PINNED_TOK = resolve(HERE, 'data/off-jp-tokens.pinned.json');
const OUT = resolve(HERE, '../src/data/catalog.json');

// Content hashes of the pinned inputs (sha256, hex). If the upstream data is
// intentionally refreshed, regenerate scripts/data/*.pinned.json and update
// these constants (otherwise the build aborts by design).
const TAX_SHA256 = '72a396230f6717f050618a9452407e93c722143e3781d37d06c0791af3df7edc';
const TOKEN_SHA256 = 'e45b389b6121718a20f275878ed197589ca0752949935ad6daafea11310ba5cb';

// Pinned so the output is byte-reproducible (the committed catalog was built
// from these same inputs on 2026-09-27).
const CATALOG_VERSION = 'off-2026-09-27';
const CATALOG_UPDATED_AT = '2026-09-27T09:21:47.366Z';

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

/** Read a pinned input and hard-fail on a content-hash mismatch. */
function loadPinned(path, label, expectedSha) {
  if (!existsSync(path)) {
    throw new Error(`${label} missing: ${path}\nPinned inputs live in scripts/data/.`);
  }
  const buf = readFileSync(path);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== expectedSha) {
    throw new Error(
      `${label} hash mismatch:\n  expected ${expectedSha}\n  actual   ${sha}\n` +
        'The pinned input changed. Update the constant intentionally, then re-run the audit.'
    );
  }
  return JSON.parse(buf.toString('utf8'));
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

/** Build the catalog bytes from the pinned inputs. */
function build() {
  console.log('Loading pinned OFF taxonomy...');
  const tax = loadPinned(PINNED_TAX, 'Pinned taxonomy', TAX_SHA256);
  const taxEntries = taxonomyEntries(tax);
  console.log(`  taxonomy entries with names: ${taxEntries.length}`);

  console.log('Loading pinned JP label tokens...');
  const tokenCache = loadPinned(PINNED_TOK, 'Pinned JP tokens', TOKEN_SHA256);
  const jpTokens = tokenCache.tokens || [];
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
    version: CATALOG_VERSION,
    updatedAt: CATALOG_UPDATED_AT,
    entries,
  };
  const bytes = Buffer.from(JSON.stringify(out));
  console.log(`  entries: ${entries.length} (${taxEntries.length} taxonomy + ${jpEntries.length} JP)`);
  console.log(`  size: ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
  return bytes;
}

function main() {
  const check = process.argv.includes('--check');
  const bytes = build();

  if (check) {
    const tmp = join(tmpdir(), 'build-catalog-check.json');
    writeFileSync(tmp, bytes);
    const ref = readFileSync(OUT);
    if (!bytes.equals(ref)) {
      let first = -1;
      for (let i = 0; i < Math.max(bytes.length, ref.length); i++) {
        if (bytes[i] !== ref[i]) { first = i; break; }
      }
      console.error(`\nCHECK FAILED: build differs from ${OUT} (first byte ${first}, built ${bytes.length} B, ref ${ref.length} B)`);
      console.error(`temp output: ${tmp}`);
      process.exit(1);
    }
    console.log(`\nCHECK OK: reproducible and byte-identical to ${OUT}`);
    return;
  }

  writeFileSync(OUT, bytes);
  console.log(`\nWrote ${OUT}`);
}

main();
