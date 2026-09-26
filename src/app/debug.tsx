import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { clearScanDebug, readScanDebug, scanDebugUri } from '@/lib/debugFile';
import { colors } from '@/theme';

export default function DebugScreen() {
  const [content, setContent] = useState(() => readScanDebug());

  const refresh = useCallback(() => setContent(readScanDebug()), []);

  const share = useCallback(async () => {
    try {
      const uri = scanDebugUri();
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Tidak bisa share', 'Sharing tidak tersedia di perangkat ini.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/x-ndjson',
        dialogTitle: 'Scan debug log',
      });
    } catch (err) {
      Alert.alert('Gagal share', String(err));
    }
  }, []);

  const clear = useCallback(() => {
    Alert.alert('Hapus debug log?', 'Semua catatan scan akan dihapus.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: () => {
          clearScanDebug();
          refresh();
        },
      },
    ]);
  }, [refresh]);

  const records = content.trim() ? content.trim().split('\n').length : 0;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.label}>File</Text>
        <Text style={styles.uri} selectable>
          {scanDebugUri()}
        </Text>
        <Text style={styles.meta}>
          {records} catatan · {content.length} char
        </Text>
      </View>

      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={share}>
          <Text style={styles.btnText}>Share</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnGhost]} onPress={refresh}>
          <Text style={[styles.btnText, styles.btnGhostText]}>Refresh</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnDanger]} onPress={clear}>
          <Text style={styles.btnText}>Hapus</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.logBox} contentContainerStyle={styles.logContent}>
        <Text style={styles.logText} selectable>
          {content || '(kosong — belum ada scan tercatat)'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12, gap: 10 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 4,
  },
  label: { fontSize: 12, color: colors.muted },
  uri: { fontSize: 12, color: colors.text },
  meta: { fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1,
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnGhost: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.brand },
  btnDanger: { backgroundColor: colors.haram },
  btnText: { color: '#fff', fontWeight: '700' },
  logBox: {
    flex: 1,
    backgroundColor: '#0f1a14',
    borderRadius: 10,
  },
  logContent: { padding: 10 },
  logText: { color: '#c8f0d8', fontSize: 11, fontFamily: 'monospace' },
});
