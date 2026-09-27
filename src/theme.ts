import type { VerdictTone } from '@/lib/verdict';
import type { HalalStatus } from '@/types';

export const colors = {
  brand: '#0B7A4B',
  bg: '#F4F6F5',
  card: '#FFFFFF',
  text: '#14231C',
  muted: '#5C6B64',
  border: '#E1E7E3',
  halal: '#1B8A4B',
  haram: '#C0392B',
  syubhat: '#C7791A',
  unknown: '#6B7280',
};

export const statusLabel: Record<HalalStatus, string> = {
  halal: 'Halal',
  haram: 'Haram',
  syubhat: 'Syubhat',
  unknown: 'Belum ditinjau',
};

export const statusColor: Record<HalalStatus, string> = {
  halal: colors.halal,
  haram: colors.haram,
  syubhat: colors.syubhat,
  unknown: colors.unknown,
};

/** Banner background per verdict tone: danger/caution/unknown/ok. */
export const verdictToneColor: Record<VerdictTone, string> = {
  danger: colors.haram,
  caution: colors.syubhat,
  unknown: colors.muted,
  ok: colors.halal,
};

export const statusRank: Record<HalalStatus, number> = {
  haram: 0,
  syubhat: 1,
  unknown: 2,
  halal: 3,
};
