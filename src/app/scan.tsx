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

import { clampRect, computeIngredientCrop, scaleRect } from '@/lib/autoCrop';
import { analyzeLayered } from '@/lib/matcher';
import { getCatalogIndex, getCuratedIndex } from '@/lib/database';
import { dblock, dlog, dscanId } from '@/lib/debug';
import { appendScanRecord } from '@/lib/debugFile';
import { cropAndUpscale, resizeToMaxWidth } from '@/lib/imagePrep';
import { extractIngredientSection } from '@/lib/normalize';
import { recognizeJapaneseDetailed } from '@/lib/ocr';
import { recognizeJapanesePaddle } from '@/lib/ocrPaddle';
import { setLastScan } from '@/lib/scanStore';
import { colors } from '@/theme';

/** Width used for the detection + full-label passes (engines resize anyway). */
const DETECT_MAX_WIDTH = 1600;

/**
 * If the merged ingredient section is shorter than this, run the extra
 * full-label PaddleOCR pass. ML Kit alone is ~10x faster, so we avoid it when
 * the crop already gave us a solid list.
 */
const ADAPTIVE_FULL_MIN_CHARS = 180;

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
      // Speed strategy (3 OCR passes instead of 5):
      //   1. downscale the label once — engines resize internally anyway
      //   2. start the full-label passes immediately and in parallel
      //   3. derive the crop from the ML Kit detail pass (already running), then
      //      run PaddleOCR on the crop only (ML Kit on the big crop was useless)
      let workUri = imageUri;
      let workW = imageWidth ?? 0;
      let workH = imageHeight ?? 0;
      if (imageWidth && imageHeight && imageWidth > DETECT_MAX_WIDTH) {
        try {
          const small = await resizeToMaxWidth(imageUri, DETECT_MAX_WIDTH);
          workUri = small.uri;
          workW = small.width;
          workH = small.height;
        } catch (err) {
          dlog(`[${sid}] RESIZE_ERR ${String(err)}`);
        }
      }

      // Full-label passes start now, in parallel with crop detection.
      const tMl = Date.now();
      const mlDetailPromise = recognizeJapaneseDetailed(workUri).then((r) => {
        dlog(`[${sid}] PASS ML-penuh ${Date.now() - tMl}ms`);
        return r;
      });

      let fullText = '';
      let cropped = false;
      let cropUri = '';
      if (workW && workH) {
        try {
          const detail = await mlDetailPromise;
          fullText = detail.text ?? '';
          const cropResult = computeIngredientCrop(detail, workW, workH);
          if (cropResult) {
            const factor = imageWidth && workW ? imageWidth / workW : 1;
            const rect = clampRect(
              scaleRect(cropResult.rect, factor),
              imageWidth ?? workW,
              imageHeight ?? workH
            );
            const prepped = await cropAndUpscale(imageUri, rect, 1);
            cropUri = prepped.uri;
            cropped = true;
            dlog(
              `[${sid}] CROP ${rect.originX},${rect.originY} ${rect.width}x${rect.height} lines=${cropResult.lines} work=${workW}x${workH}`
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
      } else {
        fullText = await mlDetailPromise.then((r) => r.text ?? '').catch(() => '');
      }

      const texts: { label: string; text: string }[] = [];
      if (fullText) texts.push({ label: 'ML Kit · penuh', text: fullText });

      // PaddleOCR pass 1: the crop (highest precision on small kanji).
      if (cropped) {
        const tPpCrop = Date.now();
        try {
          const cropText = await recognizeJapanesePaddle(cropUri);
          dlog(`[${sid}] PASS Paddle-crop ${Date.now() - tPpCrop}ms`);
          texts.push({ label: 'PaddleOCR · crop', text: cropText });
        } catch (err) {
          dlog(`[${sid}] OCR_ERR Paddle crop: ${String(err)}`);
        }
      }

      // Adaptive: ML Kit is ~10x faster than PaddleOCR, so only pay for the
      // full-label Paddle pass when what we already have is too thin to trust.
      const coverage = texts.reduce(
        (n, t) => n + extractIngredientSection(t.text).length,
        0
      );
      if (coverage < ADAPTIVE_FULL_MIN_CHARS) {
        const tPpFull = Date.now();
        try {
          const fullPaddle = await recognizeJapanesePaddle(workUri);
          dlog(`[${sid}] PASS Paddle-penuh ${Date.now() - tPpFull}ms (adaptive)`);
          texts.push({ label: 'PaddleOCR · penuh', text: fullPaddle });
        } catch (err) {
          dlog(`[${sid}] OCR_ERR Paddle penuh: ${String(err)}`);
        }
      } else {
        dlog(`[${sid}] SKIP Paddle-penuh (coverage=${coverage})`);
      }

      dlog(
        `[${sid}] OCR ms=${Date.now() - t0} cropped=${cropped} passes=${texts.length} coverage=${coverage}`
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

      // Persistent debug record (logcat rotates away).
      appendScanRecord({
        sid,
        at: new Date().toISOString(),
        ms: Date.now() - t0,
        cropped,
        passes: texts.length,
        coverage,
        matched: matched.length,
        unmatched: unmatched.length,
        hits: matched.map((f) => `${f.raw}=${f.match!.entry.status}(${f.match!.entry.id})`),
        miss: unmatched.map((f) => f.raw),
        section: combined,
        raw: texts,
      });

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
