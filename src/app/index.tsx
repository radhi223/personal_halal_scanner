import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { loadCatalog, loadCurated } from '@/lib/database';
import { warmUpPaddle } from '@/lib/ocrPaddle';
import { colors } from '@/theme';

export default function HomeScreen() {
  const curated = loadCurated();
  const catalog = loadCatalog();

  // Load the PaddleOCR models in the background so the first scan is not slow.
  useEffect(() => {
    warmUpPaddle();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Cek Halal</Text>
      <Text style={styles.subtitle}>
        Pindai label bahan makanan Jepang, lalu cek status halal/haram/syubhat setiap
        bahannya. Bekerja penuh offline.
      </Text>

      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        onPress={() => router.push('/scan')}>
        <Text style={styles.primaryText}>Mulai Pindai</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
        onPress={() => router.push('/search')}>
        <Text style={styles.secondaryText}>Cari Bahan</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
        onPress={() => router.push('/disclaimer')}>
        <Text style={styles.secondaryText}>Disclaimer &amp; Cara Pakai</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
        onPress={() => router.push('/debug')}>
        <Text style={styles.secondaryText}>Debug Scan (log tersimpan)</Text>
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Database lokal</Text>
        <Text style={styles.cardValue}>{curated.entries.length} bahan ditinjau</Text>
        <Text style={styles.cardMeta}>
          + {catalog.entries.length} nama bahan dikenal (Open Food Facts)
        </Text>
        <Text style={styles.cardMeta}>Versi {curated.version}</Text>
      </View>

      <Text style={styles.footnote}>
        Alat bantu pribadi. Bukan pengganti sertifikasi halal resmi. Selalu cek label
        halal atau tanyakan ke lembaga sertifikasi untuk kepastian.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 14,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
    marginBottom: 6,
  },
  primaryBtn: {
    backgroundColor: colors.brand,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryBtn: {
    backgroundColor: colors.card,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: {
    color: colors.brand,
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  cardLabel: {
    fontSize: 13,
    color: colors.muted,
  },
  cardValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  cardMeta: {
    fontSize: 12,
    color: colors.muted,
  },
  footnote: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 8,
  },
});
