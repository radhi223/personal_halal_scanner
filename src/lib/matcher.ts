import type { IngredientEntry, MatchResult, ScanFinding } from '@/types';
import { levenshtein, similarity } from './levenshtein';
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
}

export function buildIndex(entries: IngredientEntry[]): IngredientIndex {
  const exact = new Map<string, IngredientEntry>();
  const names: NamedTerm[] = [];

  for (const entry of entries) {
    for (const alias of entry.names) {
      const term = normalize(alias);
      if (!term) continue;
      if (!exact.has(term)) exact.set(term, entry);
      names.push({ term, entry });
    }
  }

  return { entries, exact, names };
}

/** Canonical best match for a normalized term, or null. */
export function matchNormalized(index: IngredientIndex, normalized: string): MatchResult | null {
  if (normalized.length < 2) return null;

  const exact = index.exact.get(normalized);
  if (exact) {
    return { entry: exact, matchedTerm: normalized, score: 1, kind: 'exact' };
  }

  const queryAllowance = maxFuzzyDistance(normalized.length);
  if (queryAllowance === 0) return null;

  let best: MatchResult | null = null;
  for (const { term, entry } of index.names) {
    // E-number codes must match exactly — fuzzy on "E1200" vs "量120グ" is nonsense.
    if (entry.id.startsWith('ecode:')) continue;
    const allowance = Math.min(queryAllowance, maxFuzzyDistance(term.length));
    // Cheap filter: if lengths differ by more than the allowance, distance can't fit.
    if (Math.abs(term.length - normalized.length) > allowance) continue;
    const distance = levenshtein(normalized, term);
    if (distance > allowance) continue;
    const score = similarity(normalized, term);
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
    return !strong.some((s) => similarity(s.normalized, f.normalized) >= threshold);
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

    let match = matchNormalized(curated, normalized);
    if (!match) {
      const rule = matchRule(normalized);
      if (rule) match = ruleToMatch(rule, raw);
    }
    if (!match) match = matchNormalized(catalog, normalized);

    return { raw, normalized, match };
  });
  return collapse(findings);
}
