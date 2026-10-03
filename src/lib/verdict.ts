/**
 * Result-banner verdict. PURE: no I/O, easy to unit-test.
 *
 * The banner must never claim safety when the app knows nothing: zero matches,
 * low-quality OCR, or unreviewed-only matches all resolve to a non-green tone.
 */

import type { HalalStatus } from '@/types';

export type VerdictTone = 'danger' | 'caution' | 'unknown' | 'ok';

/**
 * Status to use for DISPLAY and banner counts.
 *
 * An unreviewed entry must never be presented as a verdict. Open Food Facts
 * `vegan=yes` catalog names carry status 'halal' with `reviewed: false` — that
 * is an origin SIGNAL, not a review — and counting them as halal produced a
 * green "semua bahan sudah ditinjau" banner over unreviewed data (found by an
 * independent verifier, 2026-09-27: マントン → catalog:manganese). Warnings
 * (haram/syubhat) are never downgraded.
 */
export function effectiveStatus(entry: { status: HalalStatus; reviewed?: boolean }): HalalStatus {
  if (entry.reviewed === false && entry.status === 'halal') return 'unknown';
  return entry.status;
}

export interface VerdictInput {
  /** Counts over matched findings only. */
  haram: number;
  syubhat: number;
  halal: number;
  unknown: number;
  /** Total findings that matched a database entry. */
  matched: number;
  /**
   * Findings that did NOT match any database entry. These are NOT safe: a scan
   * with a few reviewed matches plus several unmatched tokens must never show
   * the green `ok` banner (over-claim guard).
   */
  unmatched: number;
  lowQuality: boolean;
}

export interface VerdictBanner {
  tone: VerdictTone;
  title: string;
  detail: string;
}

/**
 * Decision table, safety first:
 *   haram > syubhat > no match > low quality > unknown-only > partially unknown >
 *   unmatched-present > ok
 * `ok` is reachable only when every finding is matched AND has a reviewed verdict.
 */
export function computeVerdictBanner(input: VerdictInput): VerdictBanner {
  const { haram, syubhat, halal, unknown, matched, unmatched, lowQuality } = input;
  const unmatchedNote = unmatched > 0 ? ` • ${unmatched} belum ada di database` : '';

  if (haram > 0) {
    return {
      tone: 'danger',
      title: 'Ditemukan bahan haram',
      detail: `${haram} haram • ${syubhat} syubhat • ${matched} bahan cocok${unmatchedNote}`,
    };
  }

  if (syubhat > 0) {
    return {
      tone: 'caution',
      title: 'Ada bahan yang perlu diperhatikan',
      detail: `${syubhat} syubhat • ${unknown} belum ditinjau • ${matched} bahan cocok${unmatchedNote}`,
    };
  }

  if (matched === 0) {
    // Distinguish "photo unreadable" from "text read, nothing in the database".
    // Both mean the same thing for safety (do not eat / re-scan), but the user
    // action differs: re-frame the photo vs. search the ingredient manually.
    if (lowQuality) {
      return {
        tone: 'unknown',
        title: 'Foto kurang jelas — teks hampir tidak terbaca',
        detail: '0 bahan terbaca • foto ulang lebih dekat, cahaya cukup, hindari kilau',
      };
    }
    return {
      tone: 'unknown',
      title: 'Tidak ada bahan yang dikenali',
      detail: 'Teks terbaca tetapi 0 cocok dengan database • coba Cari Bahan manual',
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
      detail: `${halal} halal • ${unknown} belum ditinjau • ${matched} bahan cocok${unmatchedNote}`,
    };
  }

  // Unmatched tokens are not safe just because the matched ones are reviewed.
  // Green `ok` is only reachable when every finding is matched AND reviewed.
  if (unmatched > 0) {
    return {
      tone: 'caution',
      title: 'Sebagian bahan belum ada di database',
      detail: `${halal} halal • ${unmatched} belum bisa dinilai • ${matched} bahan cocok`,
    };
  }

  return {
    tone: 'ok',
    title: 'Semua bahan yang dikenali sudah ditinjau',
    detail: `${matched} bahan cocok • ${halal} halal • tidak ada temuan`,
  };
}
