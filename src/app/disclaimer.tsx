import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

export default function DisclaimerScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.heading}>Alat bantu, bukan sertifikasi</Text>
        <Text style={styles.body}>
          Aplikasi ini adalah alat bantu pribadi untuk membaca label bahan dan
          memperkirakan status halal/haram/syubhat. Aplikasi ini BUKAN pengganti
          sertifikasi halal resmi dari lembaga berwenang (mis. LPPOM MUI, JAKIM, atau
          lembaga sertifikasi di Jepang).
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Keterbatasan</Text>
        <Text style={styles.body}>
          • Hasil OCR bisa salah baca, terutama pada huruf kecil, foto blur, atau label
          berkilau.{'\n'}
          • Status "Syubhat" berarti meragukan karena informasi sumber bahan tidak
          lengkap — bukan berarti pasti haram.{'\n'}
          • Status bahan bisa berubah bila produsen mengubah formulasi.{'\n'}
          • Database ini disusun dari sumber terbuka dan referensi fatwa; tetap perlu
          verifikasi.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Saran pemakaian</Text>
        <Text style={styles.body}>
          • Foto label bagian 原材料名 (daftar bahan) sedekat dan sejelas mungkin.{'\n'}
          • Untuk produk dengan bahan syubhat, cari logo halal atau tanyakan langsung ke
          produsen.{'\n'}
          • Bila ragu, tinggalkan (prinsip syubhat).
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Sumber data</Text>
        <Text style={styles.body}>
          Nama bahan dari Open Food Facts (instance Jepang, data terbuka). Status halal
          disusun dari referensi publik: Al-Qur'an, kriteria LPPOM MUI, standar JAKIM
          MS1500:2019, dan basis data aditif E-number (EFSA). Setiap entri mencantumkan
          sumbernya pada hasil pindai.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
  },
});
