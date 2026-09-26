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

import { computeIngredientCrop } from '@/lib/autoCrop';
import { analyzeLayered } from '@/lib/matcher';
import { getCatalogIndex, getCuratedIndex } from '@/lib/database';
import { dblock, dlog, dscanId } from '@/lib/debug';
import { cropAndUpscale } from '@/lib/imagePrep';
import { extractIngredientSection } from '@/lib/normalize';
import { recognizeJapanese, recognizeJapaneseDetailed } from '@/lib/ocr';
import { recognizeJapanesePaddle } from '@/lib/ocrPaddle';
import { setLastScan } from '@/lib/scanStore';
import { colors } from '@/theme';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  async function processImage(imageUri: string, imageWidth?: number, imageHeight?: number) {
    const sid = dscanId();
    const t0 = Date.now();
    setBusy(true);
    try {
      // Phase 1: locate the 原材料名 region from ML Kit line frames, then crop to
      // it and upscale 2x. Attacking OCR error at the source (small text, noise)
      // beats patching patterns after the fact.
      let sourceUri = imageUri;
      let cropped = false;
      let fullText = '';
      if (imageWidth && imageHeight) {
        try {
          const detail = await recognizeJapaneseDetailed(imageUri);
          fullText = detail.text ?? '';
          const cropResult = computeIngredientCrop(detail, imageWidth, imageHeight);
          if (cropResult) {
            const rect = cropResult.rect;
            const prepped = await cropAndUpscale(imageUri, rect, 2);
            sourceUri = prepped.uri;
            cropped = true;
            dlog(
              `[${sid}] CROP ${rect.originX},${rect.originY} ${rect.width}x${rect.height} -> ${prepped.width}x${prepped.height} lines=${cropResult.lines}`
            );
            dlog(
              `[${sid}] CROP_HDR "${cropResult.headerText}" STOP_AT "${cropResult.boundaryText}"`
            );
          } else {
            dlog(`[${sid}] CROP none (header not found)`);
          }
        } catch (err) {
          dlog(`[${sid}] CROP_ERR ${String(err)}`);
        }
      }

      // Hybrid: OCR the FULL label and the CROPPED region, then merge.
      // - crop wins on small kanji
      // - full image recovers lines the crop missed (the crop box itself is
      //   derived from the low-quality full-image pass, so it can under-cover)
      const passes: { label: string; promise: Promise<string> }[] = [
        {
          label: 'ML Kit · penuh',
          promise: fullText ? Promise.resolve(fullText) : recognizeJapanese(imageUri),
        },
        { label: 'PaddleOCR · penuh', promise: recognizeJapanesePaddle(imageUri) },
      ];
      if (cropped) {
        passes.push({ label: 'ML Kit · crop', promise: recognizeJapanese(sourceUri) });
        passes.push({ label: 'PaddleOCR · crop', promise: recognizeJapanesePaddle(sourceUri) });
      }

      const settled = await Promise.allSettled(passes.map((p) => p.promise));
      const texts: { label: string; text: string }[] = [];
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') texts.push({ label: passes[i].label, text: r.value ?? '' });
        else dlog(`[${sid}] OCR_ERR ${passes[i].label}: ${String(r.reason)}`);
      });

      dlog(
        `[${sid}] OCR ms=${Date.now() - t0} cropped=${cropped} passes=${texts.length} chars=${texts
          .map((t) => `${t.label.includes('crop') ? 'C' : 'F'}${t.text.length}`)
          .join(',')}`
      );

      if (!texts.some((t) => t.text)) throw new Error('Semua engine OCR gagal');

      // One section per pass, deduped (crop and full often yield the same text).
      const seenSections = new Set<string>();
      const sections: { label: string; section: string }[] = [];
      for (const t of texts) {
        const section = extractIngredientSection(t.text);
        if (!section) continue;
        const key = section.replace(/\s+/g, '');
        if (seenSections.has(key)) continue;
        seenSections.add(key);
        sections.push({ label: t.label, section });
      }

      const combined = sections.map((s) => s.section).join('\n');
      const findings = analyzeLayered(getCuratedIndex(), getCatalogIndex(), combined);

      const matched = findings.filter((f) => f.match);
      const unmatched = findings.filter((f) => !f.match);
      for (const t of texts) dblock(`[${sid}] RAW ${t.label}`, t.text);
      for (const s of sections) dblock(`[${sid}] SEC ${s.label}`, s.section);
      dlog(`[${sid}] RESULT matched=${matched.length} unmatched=${unmatched.length}`);
      dlog(
        `[${sid}] HITS ${matched
          .map((f) => `${f.raw}=${f.match!.entry.status}(${f.match!.entry.id})`)
          .join(' | ')}`
      );
      dlog(`[${sid}] MISS ${unmatched.map((f) => f.raw).join(' | ')}`);

      setLastScan({
        rawText: texts.map((t) => `[${t.label}]\n${t.text}`).join('\n\n'),
        section: combined,
        findings,
        createdAt: Date.now(),
        cropped,
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
      const pic = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (pic?.uri) await processImage(pic.uri, pic.width, pic.height);
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
    const asset = result.assets?.[0];
    if (!result.canceled && asset?.uri) {
      await processImage(asset.uri, asset.width, asset.height);
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
