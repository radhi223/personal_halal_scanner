import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  getCatalogIndex,
  getCuratedIndex,
  loadCatalog,
  loadCurated,
} from '@/lib/database';
import { warmUpPaddle } from '@/lib/ocrPaddle';
import { colors } from '@/theme';

const ONBOARDED_FILE = 'onboarded.json';

export default function HomeScreen() {
  const curated = loadCurated();
  const catalog = loadCatalog();
  const [showIntro, setShowIntro] = useState(false);

  useEffect(() => {
    // Load the PaddleOCR models and build both match indexes in the background
    // so the first scan does not pay for them.
    warmUpPaddle();
    getCuratedIndex();
    getCatalogIndex();

    // First-run disclaimer gate. No new dependency: the flag is a flag file.
    try {
      const flag = new File(Paths.document, ONBOARDED_FILE);
      if (!flag.exists) setShowIntro(true);
    } catch {
      setShowIntro(true);
    }
  }, []);

  const dismissIntro = () => {
    try {
      const flag = new File(Paths.document, ONBOARDED_FILE);
      if (!flag.exists) flag.create({ overwrite: true });
      flag.write(JSON.stringify({ at: new Date().toISOString() }));
    } catch (err) {
      console.warn('[index] onboarded flag write failed:', String(err));
    }
    setShowIntro(false);
  };

  return (
    <>
      <Modal
        visible={showIntro}
        transparent
        animationType="fade"
        onRequestClose={dismissIntro}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Sebelum mulai</Text>
            <Text style={styles.modalBody}>
              Ini alat bantu baca label, BUKAN sertifikasi halal resmi. Hasil OCR bisa
              salah baca; status bahan bisa berubah bila produsen mengubah formulasi.
              Status "Syubhat" berarti meragukan, bukan pasti haram. Bila ragu,
              tinggalkan (prinsip syubhat).
            </Text>
            <Pressable style={styles.modalPrimary} onPress={dismissIntro}>
              <Text style={styles.modalPrimaryText}>Mengerti, Mulai</Text>
            </Pressable>
            <Pressable
              style={styles.modalSecondary}
              onPress={() => {
                setShowIntro(false);
                router.push('/disclaimer');
              }}>
              <Text style={styles.modalSecondaryText}>Baca Disclaimer Lengkap</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Cek Halal</Text>
        <Text style={styles.subtitle}>
          Pindai label bahan makanan Jepang, lalu cek status halal/haram/syubhat setiap
          bahannya. Berjalan offline (model presisi diunduh sekali saat pertama pakai).
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
    </>
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 20,
    gap: 12,
    width: '100%',
    maxWidth: 420,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
  },
  modalPrimary: {
    backgroundColor: colors.brand,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  modalSecondary: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  modalSecondaryText: {
    color: colors.brand,
    fontWeight: '600',
  },
});
