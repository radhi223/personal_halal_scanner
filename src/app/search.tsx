import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { getCatalogIndex, getCuratedIndex } from '@/lib/database';
import { SEARCH_LIMIT, searchIngredients, type SearchHit } from '@/lib/search';
import { colors, statusColor, statusLabel } from '@/theme';
import type { IngredientEntry } from '@/types';

const EXAMPLES = ['ゼラチン', '乳化剤', 'みりん', 'E120'];

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

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const curated = useMemo(() => getCuratedIndex(), []);
  const catalog = useMemo(() => getCatalogIndex(), []);

  // Live results: wait ~200 ms after the last keystroke before matching.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useMemo(
    () => searchIngredients(curated, catalog, debounced, SEARCH_LIMIT),
    [curated, catalog, debounced]
  );

  const hasQuery = results.normalized.length > 0;

  const fillExample = (example: string) => {
    setQuery(example);
    setDebounced(example); // chip tap should feel instant
  };

  return (
    <View style={styles.screen}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Ketik nama bahan — Jepang, romaji, Inggris, atau kode E…"
          placeholderTextColor={colors.muted}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query !== '' && (
          <Pressable onPress={() => setQuery('')} hitSlop={10} style={styles.clearBtn}>
            <Text style={styles.clearText}>×</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.examplesRow}>
        <Text style={styles.examplesLabel}>contoh:</Text>
        {EXAMPLES.map((example) => (
          <Pressable key={example} style={styles.chip} onPress={() => fillExample(example)}>
            <Text style={styles.chipText}>{example}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled">
        {!hasQuery && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Cari bahan tanpa memotret</Text>
            <Text style={styles.cardBody}>
              Pindai label bahan makanan Jepang, lalu cek status halal/haram/syubhat
              setiap bahannya. Berjalan offline (model presisi diunduh sekali saat pertama
              pakai). Ketik atau tempel nama bahan dari label Jepang — kanji, kana, atau
              romaji; hasil muncul sambil mengetik.
            </Text>
            <Text style={styles.cardMeta}>
              Database lokal: {curated.entries.length} bahan ditinjau +{' '}
              {catalog.entries.length} nama dikenal (Open Food Facts). Nama yang belum
              ditinjau selalu tampil “Belum ditinjau”, bukan halal.
            </Text>
          </View>
        )}

        {hasQuery && results.total === 0 && (
          <View style={[styles.card, styles.noResultCard]}>
            <Text style={styles.cardTitle}>Tidak ada hasil untuk “{results.query}”</Text>
            <Text style={styles.cardBody}>
              Bahan ini belum ada di database, jadi belum bisa dinilai. Coba ejaan Jepang,
              romaji, atau bagian kata yang lebih pendek. Tidak ditemukan bukan berarti
              halal.
            </Text>
          </View>
        )}

        {hasQuery && results.total > 0 && (
          <>
            <Text style={styles.countLine}>
              {results.truncated
                ? `Menampilkan ${results.hits.length} dari ${results.total} hasil`
                : `${results.total} hasil`}
            </Text>
            {results.hits.map((hit) => (
              <ResultCard key={`${hit.entry.id}:${hit.matchedTerm}`} hit={hit} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ResultCard({ hit }: { hit: SearchHit }) {
  const { entry, status } = hit;
  const color = statusColor[status];
  const isCatalog = hit.layer === 'catalog';

  return (
    <View
      style={[
        styles.card,
        styles.resultCard,
        { borderLeftColor: color },
        isCatalog && styles.catalogCard,
      ]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{hit.term}</Text>
        <View style={[styles.badge, { backgroundColor: color }]}>
          <Text style={styles.badgeText}>{statusLabel[status]}</Text>
        </View>
      </View>

      <Text style={styles.matchMeta}>
        {hit.kind === 'exact' && `cocok persis dengan "${hit.matchedTerm}"`}
        {hit.kind === 'fuzzy' &&
          `cocok mirip dengan "${hit.matchedTerm}" (${Math.round(hit.score * 100)}%)`}
        {hit.kind === 'prefix' && `nama diawali "${hit.matchedTerm}"`}
      </Text>

      <Text style={styles.matchMeta}>
        {confidenceLabel[entry.confidence]}
        {entry.basis ? ` • ${basisLabel[entry.basis]}` : ''}
        {isCatalog ? ' • belum ditinjau' : ''}
      </Text>

      <Text style={styles.cardBody}>{entry.reasoning}</Text>

      {entry.eNumber && <Text style={styles.metaLine}>Kode aditif: {entry.eNumber}</Text>}

      {entry.sources.length > 0 && (
        <Text style={styles.sources}>Sumber: {entry.sources.join(' • ')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  clearBtn: {
    paddingHorizontal: 4,
  },
  clearText: {
    fontSize: 22,
    color: colors.muted,
  },
  examplesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
  },
  examplesLabel: {
    fontSize: 12,
    color: colors.muted,
  },
  chip: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 13,
    color: colors.brand,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  container: {
    padding: 16,
    gap: 12,
  },
  countLine: {
    fontSize: 12,
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  resultCard: {
    borderLeftWidth: 5,
  },
  catalogCard: {
    borderStyle: 'dashed',
    backgroundColor: '#FAFAFA',
  },
  noResultCard: {
    borderStyle: 'dashed',
    borderColor: colors.muted,
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
  cardMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
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
});
