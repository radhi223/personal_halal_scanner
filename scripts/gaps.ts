/**
 * Cross the OFF-JP token frequency ranking with our current layers to find the
 * highest-value ingredients still lacking a verdict.
 *
 * Run: npx tsx scripts/gaps.ts
 */
// @ts-nocheck
import { readFileSync } from 'node:fs';

import { getCatalogIndex, getCuratedIndex } from '@/lib/database';
import { matchNormalized } from '@/lib/matcher';
import { isLabelNoise, normalize } from '@/lib/normalize';
import { matchRule } from '@/lib/rules';

const data = JSON.parse(
  readFileSync('D:/opencode/temp/jp-token-freq.json', 'utf8')
) as { top: [string, number][] };

const curated = getCuratedIndex();
const catalog = getCatalogIndex();

const unknown: [string, number][] = [];
const noMatch: [string, number][] = [];

let totalOcc = 0;
let coveredOcc = 0;
let noiseOcc = 0;

for (const [raw, count] of data.top) {
  totalOcc += count;
  const n = normalize(raw);
  if (isLabelNoise(n)) {
    noiseOcc += count; // origin/measurement/address boilerplate
    continue;
  }
  const c = matchNormalized(curated, n);
  if (c && c.entry.status !== 'unknown') {
    coveredOcc += count;
    continue;
  }
  const rule = matchRule(n);
  if (rule) {
    coveredOcc += count;
    continue;
  }
  const cat = matchNormalized(catalog, n);
  if (cat && cat.entry.status !== 'unknown') {
    coveredOcc += count;
    continue;
  }
  if (cat) unknown.push([raw, count]);
  else noMatch.push([raw, count]);
}

const pct = (x: number) => ((x / totalOcc) * 100).toFixed(1);
console.log(`top-800 occurrences: ${totalOcc}`);
console.log(`  covered (verdict) : ${coveredOcc} (${pct(coveredOcc)}%)`);
console.log(`  noise (non-food)  : ${noiseOcc} (${pct(noiseOcc)}%)`);
console.log(`  still unknown     : ${totalOcc - coveredOcc - noiseOcc} (${pct(totalOcc - coveredOcc - noiseOcc)}%)`);

console.log(`top tokens: ${data.top.length}`);
console.log(`unknown (recognised, no verdict): ${unknown.length}`);
console.log(`no match at all: ${noMatch.length}`);
console.log('\n=== UNKNOWN (highest value to label) ===');
for (const [raw, c] of unknown.slice(0, 120)) console.log(`${String(c).padStart(6)}  ${raw}`);
console.log('\n=== NO MATCH ===');
for (const [raw, c] of noMatch.slice(0, 60)) console.log(`${String(c).padStart(6)}  ${raw}`);
