/**
 * Extract ADDI/ITS provenance citations from the RDF dump.
 *
 * The dump is product/certificate level (see research notes): we map a product
 * label -> the certifying body that issued its halal certificate. These are
 * attached to catalog names as CITATION ONLY ("this name appears in a product
 * certified by X") — never as a verdict.
 *
 * Input : addi-resources.ttl (544k lines, ODbL)
 * Output: src/data/addi-citations.json  { <normalizedName>: { orgs:[], samples:[] } }
 *
 * Usage: node scripts/build-addi-citations.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const TTL = 'C:/Users/Radhi/AppData/Local/Temp/opencode/addi-resources.ttl';
const CATALOG = 'C:/Users/Radhi/halal-scanner/src/data/catalog.json';
const OUT = 'C:/Users/Radhi/halal-scanner/src/data/addi-citations.json';

const norm = (s) =>
  String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[・、。，．！？「」『』【】（）〔〕［］｛｝]+/g, '')
    .replace(/[.,:;!?'"`~^*_\-–—/\\|+=<>@#$%&]+/g, '');

function main() {
  if (!existsSync(TTL)) throw new Error(`missing ${TTL}`);
  const lines = readFileSync(TTL, 'utf8').split(/\r?\n/);

  // Subject lines may be indented (only the first block starts at column 0),
  // so require `<prefix>:<iri> ... a ...` with optional leading whitespace.
  const SUBJECT = /^\s*[A-Za-z]+:\S+\s+a\s+/;

  // pass 1: certificate -> issuing org
  const certOrg = new Map();
  let currentCert = null;
  for (const line of lines) {
    if (SUBJECT.test(line)) {
      const m = line.match(/^\s*halalc:(\S+)\s+a\s+/);
      currentCert = m && line.includes('halalv:HalalCertificate') ? m[1] : null;
      continue;
    }
    if (currentCert) {
      const m = line.match(/halalv:OrgCert\s+halals:(\S+)/);
      if (m) certOrg.set(currentCert, m[1].replace(/_/g, ' '));
    }
  }

  // only keep names our catalog knows (otherwise the file is multi-MB)
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  const knownNames = new Set();
  for (const e of catalog.entries) for (const n of e.names) knownNames.add(norm(n));

  // pass 2: product label -> certificate -> org
  const out = {};
  let label = null;
  let cert = null;
  let inProduct = false;
  const flush = () => {
    if (!label || !cert) return;
    const org = certOrg.get(cert);
    if (!org) return;
    const key = norm(label);
    if (!key) return;
    if (!knownNames.has(key)) return; // only cite names our catalog actually has
    const cleanOrg = org.replace(/[;,.]+\s*$/, '').trim();
    const rec = (out[key] ||= { orgs: [] });
    if (!rec.orgs.includes(cleanOrg)) rec.orgs.push(cleanOrg);
  };

  for (const line of lines) {
    if (SUBJECT.test(line)) {
      flush();
      label = null;
      cert = null;
      inProduct =
        line.includes('foodlirmm:FoodProduct') || /^\s*halalf:\S+\s+a\s+food:Food\b/.test(line);
      continue;
    }
    if (!inProduct) continue;
    const l = line.match(/rdfs:label\s+"([^"]+)"/);
    if (l && !label) label = l[1];
    const c = line.match(/foodlirmm:certificate\s+halalc:(\S+)/);
    if (c) cert = c[1];
  }
  flush();

  writeFileSync(OUT, JSON.stringify(out));
  const orgTally = {};
  for (const v of Object.values(out)) for (const o of v.orgs) orgTally[o] = (orgTally[o] || 0) + 1;
  console.log(`certificates mapped : ${certOrg.size}`);
  console.log(`labelled names cited: ${Object.keys(out).length}`);
  console.log('top issuers:');
  for (const [o, n] of Object.entries(orgTally).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(String(n).padStart(6), o);
  }
  console.log(`wrote ${OUT}`);
}

main();
