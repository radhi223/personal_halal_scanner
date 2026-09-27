/**
 * Result-banner verdict. PURE: no I/O, no imports, easy to unit-test.
 *
 * The banner must never claim safety when the app knows nothing: zero matches,
 * low-quality OCR, or unreviewed-only matches all resolve to a non-green tone.
 */

export type VerdictTone = 'danger' | 'caution' | 'unknown' | 'ok';

export interface VerdictInput {
  /** Counts over matched findings only. */
  haram: number;
  syubhat: number;
  halal: number;
  unknown: number;
  /** Total findings that matched a database entry. */
  matched: number;
  lowQuality: boolean;
}

export interface VerdictBanner {
  tone: VerdictTone;
  title: string;
  detail: string;
}

/**
 * Decision table, safety first:
 *   haram > syubhat > no match > low quality > unknown-only > partially unknown > ok
 * `ok` is reachable only when every matched ingredient has a reviewed verdict.
 */
export function computeVerdictBanner(input: VerdictInput): VerdictBanner {
  const { haram, syubhat, halal, unknown, matched, lowQuality } = input;

  if (haram > 0) {
    return {
      tone: 'danger',
      title: 'Ditemukan bahan haram',
      detail: `${haram} haram • ${syubhat} syubhat • ${matched} bahan cocok`,
    };
  }

  if (syubhat > 0) {
    return {
      tone: 'caution',
      title: 'Ada bahan yang perlu diperhatikan',
      detail: `${syubhat} syubhat • ${unknown} belum ditinjau • ${matched} bahan cocok`,
    };
  }

  if (matched === 0) {
    return {
      tone: 'unknown',
      title: 'Tidak ada bahan yang dikenali',
      detail: '0 bahan cocok dengan database • hasil belum bisa dinilai',
    };
  }

  if (lowQuality) {
    return {
      tone: 'unknown',
      title: 'Hasil mungkin kurang akurat',
      detail: `${matched} bahan cocok • ${unknown} belum ditinjau • foto kurang jelas`,
    };
  }

  if (unknown > 0 && halal === 0) {
    return {
      tone: 'unknown',
      title: 'Hanya bahan yang belum ditinjau',
      detail: `${unknown} dari ${matched} bahan belum ditinjau • belum ada penilaian`,
    };
  }

  if (unknown > 0) {
    return {
      tone: 'caution',
      title: 'Sebagian bahan belum ditinjau',
      detail: `${halal} halal • ${unknown} belum ditinjau • ${matched} bahan cocok`,
    };
  }

  return {
    tone: 'ok',
    title: 'Semua bahan yang dikenali sudah ditinjau',
    detail: `${matched} bahan cocok • ${halal} halal • tidak ada temuan`,
  };
}
