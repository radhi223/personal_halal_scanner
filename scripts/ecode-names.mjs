/**
 * Authoritative E-code naming + conflict resolution table.
 *
 * ROOT CAUSE (audited 2026-09-29): build-ecodes.mjs used to take the display
 * name from COMMUNITY datasets (HalalLens common_name -> SuhasDissa title ->
 * MUIS) with no validation. Community rows carry many bogus e_codes, so names
 * like "lecithin" landed on E375/E386 and "acesulfame potassium" on E714.
 *
 * Rules implemented here:
 *   1. `authoritativeName(code, muis)`: OFF taxonomy name.en (only when it is
 *      not just the code and not "[object Object]"), else the MUIS name, else
 *      the code itself. Community datasets NEVER contribute names.
 *   2. `OVERRIDES`: normalized-name -> canonical code(s). Used to resolve a
 *      name claimed by more than one code: it survives only on the canonical
 *      owner(s); without a canonical owner it is dropped everywhere.
 *   3. `isPlaceholderName`: drop community placeholder names defensively.
 *
 * Community rows still contribute STATUS (handled in build-ecodes.mjs).
 */
import { readFileSync } from 'node:fs';

/** Shared normalizer for name identity (must match build-catalog/ingredients). */
export function normName(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[・、。，．！？「」『』【】（）〔〕［］｛｝]+/g, '')
    .replace(/[.,:;!?'"`~^*_\-–—/\\|+=<>@#$%&]+/g, '');
}

/**
 * CORRECT-MAPPING TABLE (audited): normalized name -> canonical code(s).
 * Every other code carrying one of these names is wrong.
 * Format: 'normalizedname': 'EXXX' or 'EXXX,EYYY'.
 */
const TABLE = {
  acesulfamepotassium: 'E950',
  acetylateddistarchphosphate: 'E1414',
  ascorbylpalmitate: 'E304',
  butylatedhydroxytoluene: 'E321',
  calciumdisodiumedta: 'E385',
  calciumperoxide: 'E930',
  calciumpropionate: 'E282',
  calciumstearate: 'E470A,E572',
  calciumstearoyl2lactylate: 'E482',
  distarchphosphate: 'E1412',
  ethylcellulose: 'E462',
  hydroxypropylmethylcellulose: 'E464',
  lacticacidestersofmono: 'E472B',
  lecithin: 'E322',
  magnesiumoxide: 'E530',
  magnesiumstearate: 'E470B,E572',
  monosodiumglutamate: 'E621',
  nitrogen: 'E941',
  nitrousoxide: 'E942',
  polydextrose: 'E1200',
  polydimethylsiloxane: 'E900',
  polyglycerolestersoffattyacids: 'E475',
  polyglycerolpolyricinoleate: 'E476',
  polyoxyethylenesorbitanmonostearate: 'E435',
  polyphosphates: 'E452',
  potassiumlactate: 'E326',
  potassiumsilicate: 'E560',
  potassiumsorbate: 'E202',
  sodiumcarboxymethylcellulose: 'E466',
  sodiumferrocyanide: 'E535',
  sodiumformate: 'E237',
  sodiumlactate: 'E325',
  sodiummalate: 'E350',
  sodiumpropionate: 'E281',
  sodiumstearoyllactylate: 'E481',
  sodiumsuccinate: 'E363',
  sorbitanmonostearate: 'E491',
  stearicacid: 'E570',
  triethylcitrate: 'E1505',
  // Single-code mislabels not part of the conflict set, encoded so the wrong
  // code can never re-claim the name:
  sorbitol: 'E420',
  gelatin: 'E428',
  niacin: 'E375',
  sodiumcaseinate: 'E469',
  ammoniumstearate: 'E571',
  ammoniummalate: 'E349',
  sodiumdehydroacetate: 'E266',
  hydroxypropyldistarchglycerol: 'E1443',
};

/** normalized name -> Set(canonical code(s)). */
export const OVERRIDES = new Map(
  Object.entries(TABLE).map(([name, codes]) => [
    name,
    new Set(codes.split(',').map((c) => c.trim().toUpperCase())),
  ])
);

const PLACEHOLDER = new Set([
  'foodadditivecode',
  'mono',
  'syntheticemulsifier',
  'enumberformonosodiumglutamate',
  'modifiedstarch',
  'polyoxyethylene',
]);

/** Community placeholder noise that must never become a display name. */
export function isPlaceholderName(name) {
  return PLACEHOLDER.has(normName(name));
}

/** True when `code` is an approved canonical owner of `name`. */
export function isCanonicalOwner(name, code) {
  const set = OVERRIDES.get(normName(name));
  return !set || set.has(String(code).toUpperCase());
}

const TAX_CACHE = 'C:/Users/Radhi/AppData/Local/Temp/opencode/off-ingredients.json';
let taxIndex = null;

/** Lazily index the OFF taxonomy by E-code (key AND e_number). */
function loadTaxIndex() {
  if (taxIndex) return taxIndex;
  const tax = JSON.parse(readFileSync(TAX_CACHE, 'utf8'));
  const byCode = new Map();
  const codes = new Set();
  // Pass 1: prefer exact `en:eNNN` keys (canonical OFF ids).
  for (const [k, e] of Object.entries(tax)) {
    if (!/^en:e\d/i.test(k)) continue;
    const keyCode = 'E' + k.slice(4).toUpperCase();
    byCode.set(keyCode, e);
    codes.add(keyCode);
  }
  // Pass 2: fill gaps / register codes found via e_number.
  for (const [k, e] of Object.entries(tax)) {
    const n = e.e_number?.en ? 'E' + String(e.e_number.en).toUpperCase().replace(/^E/, '') : null;
    if (!n) continue;
    codes.add(n);
    if (!byCode.has(n)) byCode.set(n, e);
  }
  taxIndex = { byCode, codes };
  return taxIndex;
}

export function taxonomyCodes() {
  return loadTaxIndex().codes;
}

/**
 * Authoritative display name for a code.
 * @param {string} code  normalized e.g. "E950"
 * @param {Map<string,{name?:string}>} [muis] parsed MUIS map (code -> {name})
 * @returns {string}
 */
export function authoritativeName(code, muis) {
  const { byCode } = loadTaxIndex();
  const t = byCode.get(String(code).toUpperCase());
  const tName = t?.name?.en;
  if (tName && normName(tName) !== normName(code) && !/\[object Object\]/i.test(tName)) {
    return String(tName).trim();
  }
  const m = muis?.get?.(String(code).toUpperCase())?.name;
  if (m && String(m).trim()) return String(m).trim();
  return code;
}
