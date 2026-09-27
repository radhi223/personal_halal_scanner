import type { IngredientEntry, MatchResult, ScanFinding } from '@/types';
import { substitutionCost } from './confusion';
import { levenshtein, weightedSimilarity } from './levenshtein';
import { extractCandidates, normalize } from './normalize';
import { matchRule, ruleToMatch } from './rules';

/**
 * Lower bound on similarity for a fuzzy hit. Length-aware edit distance (below)
 * does the real gating; this rejects wildly different strings.
 */
export const MIN_FUZZY_SIMILARITY = 0.5;

/**
 * Allowed edit distance by term length. Japanese ingredient terms are short,
 * so a fixed similarity ratio is too harsh (one char off in a 4-char term = 0.75).
 *
 * IMPORTANT: terms of length <= 2 are exact-only. This prevents dangerous
 * confusions where one character changes the meaning entirely, e.g.
 * 豚肉 (pork, haram) vs 牛肉 (beef, halal).
 */
export function maxFuzzyDistance(termLength: number): number {
  if (termLength <= 2) return 0;
  if (termLength <= 4) return 1;
  if (termLength <= 7) return 2;
  return 3;
}

interface NamedTerm {
  term: string;
  entry: IngredientEntry;
}

export interface IngredientIndex {
  entries: IngredientEntry[];
  exact: Map<string, IngredientEntry>;
  names: NamedTerm[];
  /** Normalized names of every haram entry, used by the haram-shadow guard. */
  haramNames: NamedTerm[];
}

export function buildIndex(entries: IngredientEntry[]): IngredientIndex {
  const exact = new Map<string, IngredientEntry>();
  const names: NamedTerm[] = [];
  const haramNames: NamedTerm[] = [];

  for (const entry of entries) {
    for (const alias of entry.names) {
      const term = normalize(alias);
      if (!term) continue;
      if (!exact.has(term)) exact.set(term, entry);
      names.push({ term, entry });
      if (entry.status === 'haram') haramNames.push({ term, entry });
    }
  }

  return { entries, exact, names, haramNames };
}

/** Canonical best match for a normalized term, or null. */
export function matchNormalized(index: IngredientIndex, normalized: string): MatchResult | null {
  if (normalized.length < 2) return null;

  const exact = index.exact.get(normalized);
  if (exact) {
    return { entry: exact, matchedTerm: normalized, score: 1, kind: 'exact' };
  }

  // Short/non-food fuzzy guard. Exact matches return above and are NEVER gated.
  // Rationale: on ordinary words and brand fragments one edit is meaningless
  // evidence of food identity, and the first real-image baseline caught exactly
  // that (ただし ≈ 白だし, 加工所 ≈ 加工酢, Asahi ≈ dashi asahi/asahi→dashi is
  // edit distance 2). So refuse approximate matches when:
  //  - the normalized query is shorter than 3 characters (too little signal),
  //  - OR it is an ASCII-only fragment of 5 characters or fewer. Latin
  //    brand/product words are the main source of such false hits; the brief
  //    suggested "< 5", but the observed false verdict Asahi normalizes to
  //    'asahi' (5 chars) and sits at edit distance 2 from the curated Latin name
  //    'dashi', so the cutoff is inclusive to actually block it. Real ASCII
  //    ingredient names/codes still work: they match EXACTLY (E120, wine, …).
  // Japanese ingredient terms are unaffected (all high-stakes ones are exact or
  // ≥3 chars, e.g. ミノ酸 is caught by the rule layer, not this loop).
  if (normalized.length < 3) return null;
  if (/^[\x20-\x7e]{1,5}$/.test(normalized)) return null;

  const queryAllowance = maxFuzzyDistance(normalized.length);
  if (queryAllowance === 0) return null;

  // Haram-shadow guard: a near-miss of a haram term must NEVER be silently
  // promoted to halal/syubhat by an unrelated fuzzy match. ラート is one
  // character from ラード (lard, haram) and used to fuzzy-match ビート (beet,
  // halal), so a typo of a haram ingredient was reported halal. If the query is
  // within the length-aware fuzzy distance of ANY haram term in this index,
  // refuse the fuzzy match entirely and return null, letting the caller fall
  // through to rules/catalog/unknown (a cautious verdict or explicit "belum
  // ditinjau"). Exact matches are unaffected (returned above), so ラード itself
  // stays haram.
  for (const { term } of index.haramNames) {
    const shadowAllowance = Math.min(queryAllowance, maxFuzzyDistance(term.length));
    if (shadowAllowance <= 0) continue;
    if (Math.abs(term.length - normalized.length) > shadowAllowance) continue;
    if (levenshtein(normalized, term) <= shadowAllowance) return null;
  }

  let best: MatchResult | null = null;
  for (const { term, entry } of index.names) {
    // E-number codes must match exactly — fuzzy on "E1200" vs "量120グ" is nonsense.
    if (entry.id.startsWith('ecode:')) continue;
    // Safety invariant: fuzzy matching must NEVER produce a haram verdict.
    // Fuzzy matching is approximate, and a wrong "haram" is a severe false
    // positive (e.g. 麦芽エキス / 昆布エキス / 野菜エキス matching 豚肉エキス by
    // one character and condemning a plant/fish extract as pork). Haram claims
    // therefore require an EXACT match (returned above); this loop is only
    // allowed to yield a non-haram (halal/syubhat/unknown) approximate match.
    if (entry.status === 'haram') continue;
    const allowance = Math.min(queryAllowance, maxFuzzyDistance(term.length));
    // Cheap filter: if lengths differ by more than the allowance, distance can't fit.
    if (Math.abs(term.length - normalized.length) > allowance) continue;
    // Candidate gate stays on the UNWEIGHTED distance: a token differing by more
    // than `allowance` characters is rejected regardless of how "cheap" the
    // swaps are. Scoring then uses the confusion-weighted similarity.
    const distance = levenshtein(normalized, term);
    if (distance > allowance) continue;
    const score = weightedSimilarity(normalized, term, substitutionCost);
    if (score < MIN_FUZZY_SIMILARITY) continue;
    // Catalog names are unreviewed: demand a high bar so OCR gibberish
    // (e.g. "SoooN" vs "boron") cannot borrow a real ingredient's status.
    if (entry.id.startsWith('catalog:') && score < 0.7) continue;
    if (!best || score > best.score) {
      best = { entry, matchedTerm: term, score, kind: 'fuzzy' };
    }
  }

  return best;
}

/** Match a single raw token (normalizes first). */
export function matchTerm(index: IngredientIndex, raw: string): MatchResult | null {
  return matchNormalized(index, normalize(raw));
}

/** Collapse findings so each matched entry appears once (best score wins). */
function collapse(findings: ScanFinding[]): ScanFinding[] {
  const byEntry = new Map<string, ScanFinding>();
  const unmatched: ScanFinding[] = [];

  for (const finding of findings) {
    if (!finding.match) {
      unmatched.push(finding);
      continue;
    }
    const id = finding.match.entry.id;
    const existing = byEntry.get(id);
    if (!existing || (existing.match && finding.match.score > existing.match.score)) {
      byEntry.set(id, finding);
    }
  }

  const all = [...byEntry.values(), ...unmatched];

  // When two OCR engines disagree, one often yields the correct word (matched
  // to a real verdict) while the other yields a near-miss that only lands in the
  // unreviewed catalog (e.g. とモン vs レモン果汁). Drop those near-duplicate
  // unknowns so they don't clutter the result.
  const strong = all.filter((f) => f.match && f.match.entry.status !== 'unknown');
  return all.filter((f) => {
    const weak = !f.match || f.match.entry.status === 'unknown';
    if (!weak) return true;
    // Short tokens need a higher bar (五葱 vs 玉葱 differ by one char out of two).
    const threshold = f.normalized.length <= 3 ? 0.5 : 0.4;
    return !strong.some(
      (s) => weightedSimilarity(s.normalized, f.normalized, substitutionCost) >= threshold
    );
  });
}

/**
 * Analyze a raw OCR blob against a single index: split into candidates,
 * match each, then collapse duplicates.
 */
export function analyzeText(index: IngredientIndex, text: string): ScanFinding[] {
  const findings = extractCandidates(text).map((raw) => {
    const normalized = normalize(raw);
    return { raw, normalized, match: matchNormalized(index, normalized) };
  });
  return collapse(findings);
}

/**
 * Three-layer analysis, in priority order:
 *   1. curated   — human-reviewed labels (authoritative)
 *   2. rules     — Japan-label keyword fallback (Layer 1b)
 *   3. catalog   — recognised-but-unreviewed OFF names ("belum ditinjau")
 *
 * A curated exact entry always beats a rule, so e.g. 酵母エキス (halal) is never
 * caught by the generic エキス rule. Rules beat the catalog because a rule
 * carries an actual verdict, whereas the catalog only knows the name.
 */
export function analyzeLayered(
  curated: IngredientIndex,
  catalog: IngredientIndex,
  text: string
): ScanFinding[] {
  const findings = extractCandidates(text).map((raw) => {
    const normalized = normalize(raw);

    // Priority: exact curated > rules > fuzzy curated > catalog.
    //
    // A curated EXACT hit is authoritative and always wins (e.g. 酵母エキス
    // halal must not be caught by the generic エキス rule). A curated FUZZY hit,
    // however, is only approximate — if an explicit keyword rule matches the same
    // token, the rule (a real verdict) takes precedence over it. This stops e.g.
    // 麦芽エキス from fuzzy-matching a curated entry when the explicit /麦芽/
    // rule applies. Rules still beat the catalog, which only knows the name.
    let match = matchNormalized(curated, normalized);
    if (!match || match.kind === 'fuzzy') {
      const rule = matchRule(normalized);
      if (rule) match = ruleToMatch(rule, raw);
    }
    if (!match) match = matchNormalized(catalog, normalized);

    return { raw, normalized, match };
  });
  return collapse(findings);
}
