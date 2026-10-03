import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { appendFeedbackRecord } from '@/lib/debugFile';
import { getLastScan } from '@/lib/scanStore';
import { computeVerdictBanner, effectiveStatus } from '@/lib/verdict';
import {
  colors,
  statusColor,
  statusGuidance,
  statusLabel,
  statusRank,
  verdictToneColor,
} from '@/theme';
import type { HalalStatus, IngredientEntry, ScanFinding } from '@/types';

const STATUS_ORDER: HalalStatus[] = ['haram', 'syubhat', 'unknown', 'halal'];

const confidenceLabel: Record<IngredientEntry['confidence'], string> = {
  high: 'Keyakinan tinggi',
  medium: 'Keyakinan sedang',
  low: 'Keyakinan rendah',
};

const basisLabel: Record<NonNullable<IngredientEntry['basis']>, string> = {
  'fiqh-rule': 'kajian fikih',
  'japan-label-rule': 'pola label Jepang',
  'cross-source': 'kesepakatan antar-sumber',
  'single-source': 'satu sumber (perlu verifikasi)',
  conflict: 'sumber berbeda pendapat',
  certification: 'sertifikasi',
  'origin-signal': 'sinyal asal bahan',
};

const UNMATCHED_PREVIEW = 8;

export default function ResultScreen() {
  const scan = getLastScan();
  const [ocrOpen, setOcrOpen] = useState(false);
  const [showAllUnmatched, setShowAllUnmatched] = useState(false);

  const matched = useMemo(() => {
    if (!scan) return [];
    return scan.findings
      .filter((f) => f.match)
      .sort((a, b) => {
        const ra = a.match ? statusRank[effectiveStatus(a.match.entry)] : 99;
        const rb = b.match ? statusRank[effectiveStatus(b.match.entry)] : 99;
        if (ra !== rb) return ra - rb;
        return (b.match?.score ?? 0) - (a.match?.score ?? 0);
      });
  }, [scan]);

  const counts = useMemo(() => {
    const base: Record<HalalStatus, number> = { haram: 0, syubhat: 0, halal: 0, unknown: 0 };
    for (const f of matched) {
      // effectiveStatus: an unreviewed OFF "vegan" halal must count as unknown,
      // otherwise the banner goes green over unreviewed data.
      if (f.match) base[effectiveStatus(f.match.entry)] += 1;
    }
    return base;
  }, [matched]);

  const unmatched = useMemo(
    () => (scan ? scan.findings.filter((f) => !f.match) : []),
    [scan]
  );

  const verdict = useMemo(
    () =>
      computeVerdictBanner({
        haram: counts.haram,
        syubhat: counts.syubhat,
        halal: counts.halal,
        unknown: counts.unknown,
        matched: matched.length,
        unmatched: unmatched.length,
        lowQuality: scan?.lowQuality === true,
      }),
    [counts, matched.length, unmatched.length, scan?.lowQuality]
  );

  if (!scan) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Belum ada hasil pindai.</Text>
        <Pressable style={styles.btn} onPress={() => router.replace('/scan')}>
          <Text style={styles.btnText}>Pindai Sekarang</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={[styles.banner, { backgroundColor: verdictToneColor[verdict.tone] }]}>
        <Text style={styles.bannerText}>{verdict.title}</Text>
        <Text style={styles.bannerSub}>{verdict.detail}</Text>
      </View>

      {matched.length === 0 && (
        <View style={styles.retryBlock}>
          <Pressable style={styles.btn} onPress={() => router.replace('/scan')}>
            <Text style={styles.btnText}>Pindai Ulang</Text>
          </Pressable>
          <Pressable style={styles.retrySecondary} onPress={() => router.push('/search')}>
            <Text style={styles.retrySecondaryText}>Cari Bahan Manual</Text>
          </Pressable>
        </View>
      )}

      {scan.lowQuality && (
        <View style={[styles.card, styles.warnCard]}>
          <Text style={styles.warnTitle}>Hasil mungkin kurang akurat</Text>
          <Text style={styles.cardBody}>
            Teks bahan yang terbaca sedikit, kemungkinan foto kurang jelas. Coba foto
            ulang lebih dekat, cahaya lebih terang, dan hindari kilau pada label.
          </Text>
        </View>
      )}

      <View style={styles.countsRow}>
        {STATUS_ORDER.map((status) => (
          <View
            key={status}
            style={[styles.countCard, counts[status] === 0 && styles.countCardZero]}>
            <Text style={[styles.countNum, { color: statusColor[status] }]}>
              {counts[status]}
            </Text>
            <Text style={styles.countLabel}>{statusLabel[status]}</Text>
          </View>
        ))}
      </View>

      {matched.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tidak ada bahan yang cocok</Text>
          <Text style={styles.cardBody}>
            Teks label terbaca, tetapi belum ada yang cocok di database. Ini bukan tanda
            produk aman — foto ulang lebih dekat, atau cari nama bahannya satu per satu.
          </Text>
        </View>
      )}

      {matched.map((finding) => (
        // Key by surface form, not entry id: two different ingredients can
        // resolve to the same entry (collapse() dedupes by normalized form),
        // and each must keep its own card and feedback button state.
        <FindingCard
          key={`${finding.match!.entry.id}:${finding.normalized}`}
          finding={finding}
          sid={scan.sid}
        />
      ))}

      {unmatched.length > 0 && (
        <View style={[styles.card, styles.unknownCard]}>
          <Text style={styles.cardTitle}>
            Belum ada di database kami ({unmatched.length})
          </Text>
          <Text style={styles.cardBody}>
            Bahan ini tidak ada di database, jadi belum bisa dinilai — TIDAK berarti aman
            atau halal. Periksa sendiri di kemasan, atau cari satu per satu di menu Cari
            Bahan.
          </Text>
          {(showAllUnmatched
            ? unmatched
            : unmatched.slice(0, UNMATCHED_PREVIEW)
          ).map((f) => (
            <Text key={f.normalized} style={styles.unknownItem}>
              • {f.raw}
            </Text>
          ))}
          {unmatched.length > UNMATCHED_PREVIEW && (
            <View style={styles.moreRow}>
              {!showAllUnmatched && (
                <Text style={styles.moreText}>
                  … +{unmatched.length - UNMATCHED_PREVIEW} lainnya
                </Text>
              )}
              <Pressable onPress={() => setShowAllUnmatched((v) => !v)} hitSlop={6}>
                <Text style={styles.toggleText}>
                  {showAllUnmatched ? 'Sembunyikan' : 'Tampilkan semua'}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      <View style={styles.card}>
        <Pressable
          style={styles.ocrHeader}
          onPress={() => setOcrOpen((v) => !v)}
          hitSlop={6}>
          <Text style={styles.cardTitle}>Tampilkan teks OCR (debug)</Text>
          <Text style={styles.chevron}>{ocrOpen ? '▲' : '▼'}</Text>
        </Pressable>
        {ocrOpen && (
          <>
            <Text style={styles.ocrLabel}>
              Bagian yang dianalisis (原材料名){scan.cropped ? ' · auto-crop 2×' : ''}
            </Text>
            <Text style={styles.rawText}>{scan.section || '(tidak ditemukan)'}</Text>
            <Text style={[styles.ocrLabel, styles.ocrLabelSpaced]}>
              Teks mentah OCR (ML Kit + PaddleOCR)
            </Text>
            <Text style={styles.rawText}>{scan.rawText || '(kosong)'}</Text>
          </>
        )}
      </View>

      <Pressable style={styles.btn} onPress={() => router.replace('/scan')}>
        <Text style={styles.btnText}>Pindai Lagi</Text>
      </Pressable>
      <Pressable style={styles.linkBtn} onPress={() => router.push('/disclaimer')}>
        <Text style={styles.linkText}>Disclaimer</Text>
      </Pressable>
    </ScrollView>
  );
}

function FindingCard({ finding, sid }: { finding: ScanFinding; sid: string }) {
  const match = finding.match!;
  const entry = match.entry;
  const shown = effectiveStatus(entry);
  const color = statusColor[shown];
  const [marked, setMarked] = useState(false);

  const markWrong = () => {
    if (marked) return;
    appendFeedbackRecord({
      type: 'feedback',
      at: new Date().toISOString(),
      sid,
      raw: finding.raw,
      normalized: finding.normalized,
      entryId: entry.id,
      status: entry.status,
      matchedTerm: match.matchedTerm,
    });
    setMarked(true);
  };

  return (
    <View style={[styles.card, { borderLeftColor: color, borderLeftWidth: 5 }]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{finding.raw}</Text>
        <View style={[styles.badge, { backgroundColor: color }]}>
          <Text style={styles.badgeText}>{statusLabel[shown]}</Text>
        </View>
      </View>

      {match.kind === 'fuzzy' && (
        <Text style={styles.matchMeta}>
          Cocok mirip dengan "{match.matchedTerm}" ({Math.round(match.score * 100)}%)
        </Text>
      )}

      <Text style={styles.matchMeta}>
        {confidenceLabel[entry.confidence]}
        {entry.basis ? ` • ${basisLabel[entry.basis]}` : ''}
      </Text>

      <Text style={styles.cardBody}>{entry.reasoning}</Text>

      {entry.eNumber && <Text style={styles.metaLine}>Kode aditif: {entry.eNumber}</Text>}

      {entry.sources.length > 0 && (
        <Text style={styles.sources}>Sumber: {entry.sources.join(' • ')}</Text>
      )}

      <Text style={[styles.guidance, { color }]}>{statusGuidance[shown]}</Text>

      <Pressable onPress={markWrong} disabled={marked} style={styles.markBtn} hitSlop={6}>
        <Text style={[styles.markText, marked && styles.markTextDone]}>
          {marked
            ? 'Tercatat di log debug — bantu prioritas tinjauan database. Terima kasih.'
            : 'Tandai salah'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 15,
  },
  banner: {
    borderRadius: 14,
    padding: 16,
  },
  bannerText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  bannerSub: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    marginTop: 2,
  },
  countsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  countCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  countNum: {
    fontSize: 22,
    fontWeight: '800',
  },
  countCardZero: {
    opacity: 0.35,
  },
  countLabel: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  retryBlock: {
    gap: 8,
  },
  retrySecondary: {
    backgroundColor: colors.card,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.brand,
  },
  retrySecondaryText: {
    color: colors.brand,
    fontWeight: '700',
    fontSize: 16,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  unknownCard: {
    borderStyle: 'dashed',
    borderColor: colors.muted,
  },
  warnCard: {
    backgroundColor: '#FFF7E8',
    borderColor: colors.syubhat,
  },
  warnTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.syubhat,
  },
  unknownItem: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 2,
  },
  moreText: {
    fontSize: 13,
    color: colors.muted,
  },
  toggleText: {
    fontSize: 13,
    color: colors.brand,
    fontWeight: '700',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  matchMeta: {
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  metaLine: {
    fontSize: 12,
    color: colors.muted,
  },
  sources: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
  },
  markBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 2,
  },
  markText: {
    fontSize: 13,
    color: colors.muted,
  },
  markTextDone: {
    color: colors.haram,
    fontWeight: '700',
  },
  ocrHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  chevron: {
    fontSize: 13,
    color: colors.muted,
  },
  ocrLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  ocrLabelSpaced: {
    marginTop: 6,
  },
  rawText: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
  },
  guidance: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  btn: {
    backgroundColor: colors.brand,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  linkBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  linkText: {
    color: colors.brand,
    fontWeight: '600',
  },
});
