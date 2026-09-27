import type { HalalStatus, IngredientEntry } from '@/types';
import { analyzeLayered, type IngredientIndex } from './matcher';
import { normalize } from './normalize';

/**
 * Offline ingredient search.
 *
 * PURE module (no I/O, no native imports): takes the already-built indexes and
 * returns ranked hits. The verdict for the typed token comes from
 * analyzeLayered(), i.e. the exact same layered priority the scanner uses
 * (curated exact > rules > fuzzy curated > catalog), so a search result can
 * never disagree with a scan of the same word.
 *
 * Prefix rows are a browse aid only: they list CURATED entries whose alias
 * starts with the query and are labelled "nama diawali …" in the UI. Catalog
 * aliases are deliberately not prefixed: they are unreviewed taxonomy/harvested
 * label fragments (e.g. ゼラチンを含む), so prefix-scanning them would bury the
 * real result under "belum ditinjau" noise. Catalog names still resolve through
 * the layered matcher when typed (or pasted) in full.
 *
 * Honesty rule: catalog (unreviewed Open Food Facts) entries are surfaced with
 * status 'unknown' even when loadCatalog() attached a weak vegan
 * origin-signal "halal" candidate; the helper must never hand the UI a catalog
 * hit that looks like a reviewed verdict.
 */

export const SEARCH_LIMIT = 30;

export type SearchLayer = 'curated' | 'rule' | 'catalog';
export type SearchMatchKind = 'exact' | 'fuzzy' | 'prefix';

export interface SearchHit {
  /** Entry carrying reasoning/sources/confidence. */
  entry: IngredientEntry;
  /** Status the UI must display; always 'unknown' for catalog hits. */
  status: HalalStatus;
  /** Which layer produced the token verdict. */
  layer: SearchLayer;
  /** exact/fuzzy come from the scan matcher; prefix is a browse aid. */
  kind: SearchMatchKind;
  /** Headline term: the raw query token, or the alias for prefix rows. */
  term: string;
  /** Database alias that matched (normalized). */
  matchedTerm: string;
  /** 0..1 matcher similarity; 1 for exact and prefix rows. */
  score: number;
}

export interface SearchResults {
  query: string;
  normalized: string;
  /** Capped at `limit`; see `total` for the uncapped count. */
  hits: SearchHit[];
  /** Total matches before the cap. */
  total: number;
  truncated: boolean;
}

function layerOf(entry: IngredientEntry): SearchLayer {
  if (entry.id.startsWith('catalog:')) return 'catalog';
  if (entry.id.startsWith('rule:')) return 'rule';
  return 'curated';
}

/** Display status: catalog entries are never allowed to look reviewed. */
function displayStatus(entry: IngredientEntry, layer: SearchLayer): HalalStatus {
  return layer === 'catalog' ? 'unknown' : entry.status;
}

/**
 * Aliases in `index` that start with the normalized query but are not the exact
 * query itself. Rows are sorted shortest-alias-first for a stable browse list.
 */
function prefixHits(
  index: IngredientIndex,
  normalized: string,
  seen: Set<string>
): SearchHit[] {
  const rows: SearchHit[] = [];
  for (const { term, entry } of index.names) {
    if (term === normalized || !term.startsWith(normalized)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const layer = layerOf(entry);
    rows.push({
      entry,
      status: displayStatus(entry, layer),
      layer,
      kind: 'prefix',
      term,
      matchedTerm: term,
      score: 1,
    });
  }
  rows.sort(
    (a, b) =>
      a.matchedTerm.length - b.matchedTerm.length ||
      (a.matchedTerm < b.matchedTerm ? -1 : a.matchedTerm > b.matchedTerm ? 1 : 0)
  );
  return rows;
}

/**
 * Search curated + catalog layers for `query` and return ranked hits.
 *
 * Layer 1 (verdict) is single-token scan analysis; layer 2 (browse) adds prefix
 * aliases. The result list is capped at `limit`, with `total` kept uncapped so
 * the UI can say "Menampilkan 30 dari N hasil".
 */
export function searchIngredients(
  curated: IngredientIndex,
  catalog: IngredientIndex,
  query: string,
  limit: number = SEARCH_LIMIT
): SearchResults {
  const normalized = normalize(query);
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SEARCH_LIMIT;
  if (!normalized) {
    return { query, normalized, hits: [], total: 0, truncated: false };
  }

  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  // 1) Scan-identical layered verdict for the typed token(s). A pasted
  // comma-separated list is split by extractCandidates and each token gets its
  // own verdict, exactly like a scan.
  for (const finding of analyzeLayered(curated, catalog, query)) {
    if (!finding.match) continue;
    const { entry, matchedTerm, kind, score } = finding.match;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const layer = layerOf(entry);
    hits.push({
      entry,
      status: displayStatus(entry, layer),
      layer,
      kind,
      term: finding.raw,
      matchedTerm,
      score,
    });
  }

  // 2) Browse aid: curated aliases beginning with the query. Entries already
  // returned as a verdict are skipped.
  hits.push(...prefixHits(curated, normalized, seen));

  const total = hits.length;
  return { query, normalized, hits: hits.slice(0, cap), total, truncated: total > cap };
}
