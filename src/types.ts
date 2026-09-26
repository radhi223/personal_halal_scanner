export type HalalStatus = 'halal' | 'haram' | 'syubhat' | 'unknown';

/**
 * How much we trust a verdict.
 *  high   : fiqh rule / multi-source consensus / official citation
 *  medium : single reputable source, or Japan-label keyword rule
 *  low    : unreviewed name recognition only (catalog)
 */
export type Confidence = 'high' | 'medium' | 'low';

/** Where a verdict came from. Drives the "why should I trust this" text in the UI. */
export type Basis =
  | 'fiqh-rule' // reasoned from known origin / classical ruling
  | 'japan-label-rule' // matched a Japan-specific label keyword rule
  | 'cross-source' // >=2 independent datasets agree
  | 'single-source' // only one dataset -> candidate, needs verification
  | 'conflict' // sources disagree -> treated cautiously
  | 'certification' // backed by a certifying body record
  | 'origin-signal'; // weak signal (vegan/vegetarian/origin), not decisive

export interface IngredientEntry {
  /** Stable unique id, e.g. "gelatin" or "rule:animal-extract". */
  id: string;
  /** All known surface forms: kanji, kana, romaji, English, E-number. */
  names: string[];
  status: HalalStatus;
  confidence: Confidence;
  /** Absent for 'unknown' catalog entries (name recognised, no verdict made). */
  basis?: Basis;
  /** true = human-reviewed entry; false = recognized name only (catalog). */
  reviewed: boolean;
  /** Short grouping, e.g. "additive", "animal-derived", "alcohol". */
  category?: string;
  /** Why this status was assigned. Shown to user after scan. */
  reasoning: string;
  /** References backing the label. Shown to user after scan. */
  sources: string[];
  /** Optional E-number if applicable. */
  eNumber?: string;
}

export interface DatabaseFile {
  version: string;
  updatedAt: string;
  entries: IngredientEntry[];
}

/** Unreviewed name from Open Food Facts. Status defaults to "unknown" at load. */
export type OffFlag = 'yes' | 'no' | 'maybe';

export interface CatalogEntry {
  id: string;
  names: string[];
  /** 'tax' = OFF ingredient taxonomy; 'jp' = harvested from Japanese product labels. */
  src: 'tax' | 'jp';
  eNumber?: string;
  /** Open Food Facts origin signals (taxonomy only). Weak, not a verdict. */
  vegan?: OffFlag;
  vegetarian?: OffFlag;
  palmOil?: OffFlag;
}

export interface CatalogFile {
  version: string;
  updatedAt: string;
  entries: CatalogEntry[];
}

export type MatchKind = 'exact' | 'fuzzy';

export interface MatchResult {
  entry: IngredientEntry;
  /** The database term that matched. */
  matchedTerm: string;
  /** 0..1, 1 = exact. */
  score: number;
  kind: MatchKind;
}

export interface ScanFinding {
  /** Raw token as it came from OCR. */
  raw: string;
  /** Normalized form used for matching. */
  normalized: string;
  match: MatchResult | null;
}
