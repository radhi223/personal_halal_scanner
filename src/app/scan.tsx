import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { analyzeLayered } from '@/lib/matcher';
import { getCatalogIndex, getCuratedIndex } from '@/lib/database';
import { dblock, dlog, dscanId } from '@/lib/debug';
import { extractIngredientSection } from '@/lib/normalize';
import { recognizeJapanese } from '@/lib/ocr';
import { recognizeJapanesePaddle } from '@/lib/ocrPaddle';
import { setLastScan } from '@/lib/scanStore';
import { colors } from '@/theme';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  async function processImage(imageUri: string) {
    const sid = dscanId();
    const t0 = Date.now();
    setBusy(true);
    try {
      // Run both engines; whichever succeeds contributes. Paddle is better on
      // hard kanji, ML Kit is the proven fallback.
      const [ml, pp] = await Promise.allSettled([
        recognizeJapanese(imageUri),
        recognizeJapanesePaddle(imageUri),
      ]);
      if (ml.status === 'rejected') dlog(`[${sid}] ML_ERR ${String(ml.reason)}`);
      if (pp.status === 'rejected') dlog(`[${sid}] PP_ERR ${String(pp.reason)}`);

      const mlText = ml.status === 'fulfilled' ? ml.value : '';
      const ppText = pp.status === 'fulfilled' ? pp.value : '';
      dlog(
        `[${sid}] OCR ms=${Date.now() - t0} mlChars=${mlText.length} ppChars=${ppText.length} uri=${imageUri}`
      );

      if (!mlText && !ppText) {
        throw new Error(
          [
            ml.status === 'rejected' ? `ML Kit: ${ml.reason}` : '',
            pp.status === 'rejected' ? `Paddle: ${pp.reason}` : '',
          ]
            .filter(Boolean)
            .join(' | ')
        );
      }

      const mlSection = extractIngredientSection(mlText);
      const ppSection = extractIngredientSection(ppText);
      const combined = [mlSection, ppSection].filter(Boolean).join('\n');
      const findings = analyzeLayered(getCuratedIndex(), getCatalogIndex(), combined);

      const matched = findings.filter((f) => f.match);
      const unmatched = findings.filter((f) => !f.match);
      dblock(`[${sid}] ML_RAW`, mlText);
      dblock(`[${sid}] PP_RAW`, ppText);
      dblock(`[${sid}] ML_SEC`, mlSection);
      dblock(`[${sid}] PP_SEC`, ppSection);
      dlog(`[${sid}] RESULT matched=${matched.length} unmatched=${unmatched.length}`);
      dlog(
        `[${sid}] HITS ${matched
          .map((f) => `${f.raw}=${f.match!.entry.status}(${f.match!.entry.id})`)
          .join(' | ')}`
      );
      dlog(`[${sid}] MISS ${unmatched.map((f) => f.raw).join(' | ')}`);

      setLastScan({
        rawText: [
          mlText ? `[ML Kit]\n${mlText}` : '',
          ppText ? `[PaddleOCR]\n${ppText}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        section: combined,
        findings,
        createdAt: Date.now(),
      });
      router.replace('/result');
    } catch (err) {
      dlog(`[${sid}] FATAL ${String(err)}`);
      Alert.alert('Gagal memproses', String(err));
    } finally {
      setBusy(false);
    }
  }

  async function capture() {
    if (!cameraRef.current || !ready || busy) return;
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (pic?.uri) await processImage(pic.uri);
    } catch (err) {
      Alert.alert('Gagal memotret', String(err));
    }
  }

  async function pickFromGallery() {
    if (busy) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      await processImage(result.assets[0].uri);
    }
  }

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permTitle}>Izin kamera diperlukan</Text>
        <Text style={styles.permText}>
          Aplikasi butuh akses kamera untuk memindai label bahan.
        </Text>
        <Pressable style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Beri Izin</Text>
        </Pressable>
        <Pressable style={styles.linkBtn} onPress={pickFromGallery}>
          <Text style={styles.linkText}>Pilih dari galeri saja</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        onCameraReady={() => setReady(true)}
      />

      <View style={styles.hintWrap} pointerEvents="none">
        <Text style={styles.hint}>Arahkan ke daftar bahan (原材料名)</Text>
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.galleryBtn} onPress={pickFromGallery} disabled={busy}>
          <Text style={styles.galleryText}>Galeri</Text>
        </Pressable>

        <Pressable
          style={[styles.shutter, busy && styles.shutterDisabled]}
          onPress={capture}
          disabled={busy || !ready}>
          {busy ? <ActivityIndicator color="#fff" /> : <View style={styles.shutterInner} />}
        </Pressable>

        <View style={styles.galleryBtnPlaceholder} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: colors.bg,
  },
  permTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  permText: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
  },
  permBtn: {
    backgroundColor: colors.brand,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  permBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  linkBtn: {
    paddingVertical: 8,
  },
  linkText: {
    color: colors.brand,
    fontWeight: '600',
  },
  hintWrap: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  hint: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    fontSize: 13,
    overflow: 'hidden',
  },
  controls: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 24,
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDisabled: {
    opacity: 0.6,
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  galleryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  galleryText: {
    color: '#fff',
    fontWeight: '600',
  },
  galleryBtnPlaceholder: {
    width: 64,
  },
});
