import type {
  CatalogFile,
  Confidence,
  DatabaseFile,
  IngredientEntry,
} from '@/types';
import bundled from '@/data/ingredients.json';
import ecodeRaw from '@/data/ecodes.json';
import catalogRaw from '@/data/catalog.json';
import addiRaw from '@/data/addi-citations.json';
import { buildIndex, type IngredientIndex } from './matcher';
import { normalize } from './normalize';

type CitationMap = Record<string, { orgs: string[] }>;
const addiCitations = addiRaw as unknown as CitationMap;

/** ADDI/ITS provenance string for a set of names, or null. Citation only. */
function citationFor(names: string[]): string | null {
  const orgs = new Set<string>();
  for (const n of names) {
    const c = addiCitations[normalize(n)];
    if (c) for (const o of c.orgs) orgs.add(o);
  }
  return orgs.size ? `ADDI ITS (ODbL) — ditemukan di produk bersertifikat: ${[...orgs].join(', ')}` : null;
}

/**
 * Curated, human-reviewed database: halal/haram/syubhat labels with reasoning
 * and sources. Ships bundled (offline). This is the authoritative layer.
 *
 * Entries authored before the schema lock may omit confidence/basis/reviewed;
 * we normalise them here so the rest of the app can rely on the fields.
 */
export function loadCurated(): { version: string; entries: IngredientEntry[] } {
  const file = bundled as unknown as DatabaseFile;
  const ecodes = ecodeRaw as unknown as DatabaseFile;
  const all = [...file.entries, ...ecodes.entries];
  const entries = all.map((e) => ({
    ...e,
    confidence: e.confidence ?? ('high' as Confidence),
    basis: e.basis ?? 'fiqh-rule',
    reviewed: e.reviewed ?? true,
  }));
  return { version: `${file.version}+${ecodes.version}`, entries };
}

/**
 * Unreviewed Open Food Facts names (taxonomy + harvested JP labels). Expanded
 * into "unknown" entries: recognised, but no verdict attached.
 */
export function loadCatalog(): { version: string; entries: IngredientEntry[] } {
  const file = catalogRaw as unknown as CatalogFile;
  const entries: IngredientEntry[] = file.entries.map((e) => {
    const offSource =
      e.src === 'jp'
        ? 'Open Food Facts — label produk Jepang'
        : 'Open Food Facts — ingredients taxonomy';

    // Layer 2 origin signal: vegan=yes is a WEAK halal candidate, not a verdict.
    const citation = citationFor(e.names);
    const sources = citation ? [offSource, citation] : [offSource];

    if (e.src === 'tax' && e.vegan === 'yes') {
      return {
        id: `catalog:${e.id}`,
        names: e.names,
        status: 'halal',
        confidence: 'low',
        basis: 'origin-signal',
        reviewed: false,
        category: 'off-vegan',
        reasoning:
          'Open Food Facts menandai bahan ini VEGAN (nabati/mikroba). Kandidat halal, tetapi belum diverifikasi — masih mungkin ada alkohol atau proses yang tidak halal.',
        sources,
        eNumber: e.eNumber,
      };
    }

    const vegNote =
      e.src === 'tax' && e.vegetarian === 'yes'
        ? ' Open Food Facts menandai VEGETARIAN (bisa mengandung susu/telur, perlu cek rennet/enzim).'
        : '';

    return {
      id: `catalog:${e.id}`,
      names: e.names,
      status: 'unknown',
      confidence: 'low',
      reviewed: false,
      category: e.src === 'jp' ? 'produk-jepang' : 'off',
      reasoning:
        (e.src === 'jp'
          ? 'Nama ini ditemukan pada label produk Jepang (Open Food Facts) tetapi belum ditinjau status halalnya.'
          : 'Nama dari taksonomi bahan Open Food Facts; belum ditinjau status halalnya.') + vegNote,
      sources,
      eNumber: e.eNumber,
    };
  });
  return { version: file.version, entries };
}

/** Back-compat convenience for the home screen. */
export function loadDatabase(): { version: string; entries: IngredientEntry[] } {
  return loadCurated();
}

let curatedIndex: IngredientIndex | null = null;
let catalogIndex: IngredientIndex | null = null;

export function getCuratedIndex(): IngredientIndex {
  if (!curatedIndex) curatedIndex = buildIndex(loadCurated().entries);
  return curatedIndex;
}

export function getCatalogIndex(): IngredientIndex {
  if (!catalogIndex) catalogIndex = buildIndex(loadCatalog().entries);
  return catalogIndex;
}
