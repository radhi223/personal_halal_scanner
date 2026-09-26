/**
 * Build the E-number verdict table (Layer 1) from three sources:
 *
 *   1. MUIS Food Additive Listing (Majlis Ugama Islam Singapura, Singapore gov)
 *      -> OFFICIAL. Text extracted with: pdftotext -layout. Entries marked with
 *         "*" are "Syubhah / Doubtful"; unmarked = not doubtful (permissible).
 *         Source PDF: isomer-user-content.by.gov.sg/.../FOOD ADDITIVE LISTING 5.pdf
 *         Last updated 13 Sep 2016.
 *   2. HalalLens e-number dataset (CC-BY-4.0) — community/AI, source-cited.
 *   3. SuhasDissa E-Number-Database (GPL-3.0) — community.
 *
 * Weighting (implements the agreed policy for partial overlap):
 *   - MUIS "syubhah"                     -> syubhat, high  (certification)
 *   - MUIS not-doubtful + community ok   -> halal, high    (certification)
 *   - MUIS not-doubtful + community doubts -> syubhat, medium (scholarly difference)
 *   - no MUIS, >=2 community agree       -> that verdict, high (cross-source)
 *   - no MUIS, conflict                  -> syubhat, low (conflict, show positions)
 *   - single Suhas                       -> its verdict, medium (single-source)
 *   - single HalalLens                   -> its verdict, low    (single-source candidate)
 *
 * Output: src/data/ecodes.json (full IngredientEntry records)
 *
 * Usage: node scripts/build-ecodes.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const T = 'C:/Users/Radhi/AppData/Local/Temp/opencode';
const MUIS_TXT = `${T}/muis-additives.txt`;
const HL_JSONL = `${T}/hl-enumbers.jsonl`;
const SU_JSON = `${T}/suhas-additives.json`;
const OUT = 'C:/Users/Radhi/halal-scanner/src/data/ecodes.json';

const SRC = {
  muis: 'MUIS Food Additive Listing (13 Sep 2016)',
  hl: 'HalalLens e-number dataset (CC-BY-4.0)',
  su: 'SuhasDissa E-Number-Database (GPL-3.0)',
};

const normCode = (c) => {
  const t = String(c || '').trim().toUpperCase().replace(/^E?/, '');
  return t ? `E${t}` : '';
};
const normStatus = (s) => {
  const t = String(s || '').trim().toLowerCase();
  if (t.startsWith('halal')) return 'halal';
  if (t.startsWith('haram') || t.startsWith('not halal')) return 'haram';
  if (t.startsWith('mush') || t.startsWith('doubt') || t.startsWith('suspect') || t.startsWith('syubhah'))
    return 'syubhat';
  return 'unknown';
};

// ---- 1. MUIS ---------------------------------------------------------------
function parseMuis() {
  const lines = readFileSync(MUIS_TXT, 'utf8').split(/\r?\n/);
  const out = new Map();
  for (const line of lines) {
    const m = line.match(/^\s*(\d{3,4}[a-zA-Z]?)\s+(\S.*)$/);
    if (!m) continue;
    const code = normCode(m[1]);
    // name is the first 2+space separated column; a "*" anywhere in it = syubhah
    const cols = m[2].split(/\s{2,}/);
    const nameCell = (cols[0] || '').trim();
    if (!nameCell) continue;
    const syubhah = nameCell.includes('*');
    const name = nameCell.replace(/\*/g, '').trim();
    if (!name || out.has(code)) continue;
    out.set(code, { code, name, status: syubhah ? 'syubhat' : 'halal' });
  }
  return out;
}

// ---- 2/3. community --------------------------------------------------------
function loadHalalLens() {
  const rows = readFileSync(HL_JSONL, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  const out = new Map();
  for (const r of rows) out.set(normCode(r.e_code), { status: normStatus(r.halal_status), name: r.common_name || '' });
  return out;
}
function loadSuhas() {
  const rows = JSON.parse(readFileSync(SU_JSON, 'utf8'));
  const out = new Map();
  for (const r of rows) out.set(normCode(r.e_code), { status: normStatus(r.halal_status), name: r.title || '' });
  return out;
}

// ---- decide ----------------------------------------------------------------
function decide(muis, hl, su) {
  const community = [hl?.status, su?.status].filter(Boolean);
  const communityAgree = community.length >= 2 && hl.status === su.status;
  const communityDoubts = community.some((s) => s === 'haram' || s === 'syubhat');

  if (muis?.status === 'syubhat') {
    return {
      status: 'syubhat',
      confidence: 'high',
      basis: 'certification',
      reasoning:
        'MUIS (Majlis Ugama Islam Singapura) menandai aditif ini "Syubhah / Doubtful" karena sumber atau proses produksinya meragukan.',
      sources: [SRC.muis],
    };
  }
  if (muis?.status === 'halal') {
    if (communityDoubts) {
      return {
        status: 'syubhat',
        confidence: 'medium',
        basis: 'conflict',
        reasoning: `MUIS tidak menandai syubhah, tetapi sumber komunitas berbeda pendapat (HalalLens: ${hl?.status ?? '-'} · SuhasDissa: ${su?.status ?? '-'}). Ikuti sikap hati-hati.`,
        sources: [SRC.muis, ...(hl ? [SRC.hl] : []), ...(su ? [SRC.su] : [])],
      };
    }
    return {
      status: 'halal',
      confidence: 'high',
      basis: 'certification',
      reasoning: 'MUIS tidak menandai aditif ini sebagai syubhah, dan sumber komunitas tidak berbeda pendapat.',
      sources: [SRC.muis, ...(hl ? [SRC.hl] : []), ...(su ? [SRC.su] : [])],
    };
  }
  // no MUIS
  if (communityAgree) {
    return {
      status: hl.status,
      confidence: 'high',
      basis: 'cross-source',
      reasoning: `Dua sumber independen sepakat: ${hl.status}.`,
      sources: [SRC.hl, SRC.su],
    };
  }
  if (hl && su && hl.status !== su.status) {
    return {
      status: 'syubhat',
      confidence: 'low',
      basis: 'conflict',
      reasoning: `Sumber berbeda pendapat (HalalLens: ${hl.status} · SuhasDissa: ${su.status}). Tidak ada arbiter resmi; ambil sikap hati-hati.`,
      sources: [SRC.hl, SRC.su],
    };
  }
  if (su) {
    return {
      status: su.status,
      confidence: 'medium',
      basis: 'single-source',
      reasoning: `Hanya satu sumber komunitas (SuhasDissa) yang mencakup ini: ${su.status}. Perlu verifikasi.`,
      sources: [SRC.su],
    };
  }
  if (hl) {
    return {
      status: hl.status,
      confidence: 'low',
      basis: 'single-source',
      reasoning: `Hanya HalalLens yang mencakup ini: ${hl.status}. Kandidat, perlu verifikasi (dataset ini terbukti condong ke "halal").`,
      sources: [SRC.hl],
    };
  }
  return null;
}

function main() {
  for (const f of [MUIS_TXT, HL_JSONL, SU_JSON]) {
    if (!existsSync(f)) throw new Error(`missing input: ${f}`);
  }
  const muis = parseMuis();
  const hl = loadHalalLens();
  const su = loadSuhas();
  console.log(`MUIS codes: ${muis.size} (syubhah ${[...muis.values()].filter((x) => x.status === 'syubhat').length})`);
  console.log(`HalalLens : ${hl.size}`);
  console.log(`Suhas     : ${su.size}`);

  const codes = new Set([...muis.keys(), ...hl.keys(), ...su.keys()]);
  const entries = [];
  const dist = {};
  for (const code of [...codes].sort()) {
    const d = decide(muis.get(code), hl.get(code), su.get(code));
    if (!d) continue;
    dist[d.status] = (dist[d.status] || 0) + 1;

    const names = [code];
    const cname = (hl.get(code)?.name || su.get(code)?.name || muis.get(code)?.name || '').trim();
    if (cname && cname.toUpperCase() !== code) names.push(cname);

    entries.push({
      id: `ecode:${code}`,
      names,
      status: d.status,
      confidence: d.confidence,
      basis: d.basis,
      reviewed: true,
      category: 'additive',
      reasoning: d.reasoning,
      sources: d.sources,
      eNumber: code,
    });
  }

  const out = { version: `ecodes-${new Date().toISOString().slice(0, 10)}`, updatedAt: new Date().toISOString(), entries };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`\nWrote ${OUT}`);
  console.log(`  entries: ${entries.length}`);
  console.log(`  status : ${JSON.stringify(dist)}`);
}

main();
