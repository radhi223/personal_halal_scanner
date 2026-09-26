# Halal Scanner (Jepang)

Aplikasi Android pribadi untuk **memindai label bahan makanan Jepang** dan mengecek
status halal/haram/syubhat tiap bahannya — **sepenuhnya offline**, tanpa iklan,
tanpa langganan.

Foto label → OCR on-device → ekstrak bagian `原材料名` → cocokkan ke database →
keluar daftar bahan beserta status, alasan, dan sumber.

---

## Daftar isi

- [1. Tujuan aplikasi](#1-tujuan-aplikasi)
- [2. Fitur](#2-fitur)
- [3. Cara kerja (pipeline)](#3-cara-kerja-pipeline)
- [4. Sumber data](#4-sumber-data)
- [5. Aturan klasifikasi & alasannya](#5-aturan-klasifikasi--alasannya)
- [6. Disclaimer (baca ini)](#6-disclaimer-baca-ini)
- [7. Instalasi dari nol sampai jalan](#7-instalasi-dari-nol-sampai-jalan)
- [8. Development](#8-development)
- [9. Struktur project](#9-struktur-project)
- [10. Keterbatasan yang diketahui](#10-keterbatasan-yang-diketahui)
- [11. Lisensi & atribusi](#11-lisensi--atribusi)

---

## 1. Tujuan aplikasi

Dibuat untuk **pemakaian pribadi** saat belanja/makan di Jepang. Alasan utama:
aplikasi halal yang ada di pasaran penuh iklan dan/atau berlangganan, sedangkan
kebutuhan sehari-hari sederhana — *"bahan di label ini halal, haram, atau perlu
dicek?"*

Keputusan desain yang mengikuti tujuan itu:

| Prinsip | Konsekuensi teknis |
|---|---|
| **Offline penuh** untuk alur scan | OCR on-device + database dibundel di APK |
| **Tanpa biaya berjalan** | Tanpa VPS; semua sumber data gratis/terbuka |
| **Jujur soal ketidakpastian** | Status `unknown`/`syubhat` ditampilkan apa adanya, tidak dipaksa jadi halal/haram |
| **Sumber bisa dilacak** | Tiap entri menyimpan alasan + daftar sumber |
| **Tidak mencuri data** | Tidak mengekstrak database dari aplikasi komersial mana pun |

Target penggunaan: sideload APK sendiri (bukan Play Store).

---

## 2. Fitur

- **Pindai lewat kamera** atau pilih foto dari galeri.
- **OCR dua engine** dijalankan paralel (lihat §3).
- **Ekstraksi bagian bahan** otomatis dari foto label penuh (nama produk, harga,
  tanggal, nutrisi, alamat, barcode ikut terfoto — ini normal).
- **Hasil per bahan**: badge status + tingkat keyakinan + alasan + sumber.
- **Bagian "Belum ditinjau"** menampilkan bahan yang dikenal tapi belum diberi
  status, dan **"Belum ada di database"** menampilkan teks mentah yang tidak
  dikenali — tanpa menyembunyikan apa pun.
- **Nilai E-number** (E120, E471, …) dengan arbiter lembaga resmi (lihat §4).
- **Filter noise label**: alamat, nomor telepon, tanggal, ukuran, instruksi masak
  dibuang sebelum pencocokan.

---

## 3. Cara kerja (pipeline)

```
Kamera / Galeri
      │
      ▼
┌─────────────────────────────────────────────┐
│ OCR (paralel, Promise.allSettled)           │
│  • ML Kit Text Recognition (Japanese)       │
│  • PaddleOCR PP-OCRv5 (onnxruntime + Skia)  │
│  Gagal salah satu → tetap lanjut             │
└─────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────┐
│ Ekstraksi section 原材料名                    │
│  • Toleran varian OCR: 所材料名 / 原材名 /    │
│    対料名 / 材料名                            │
│  • Baris disambung TANPA pemisah (kata       │
│    terpotong OCR: マヨネ + ズ → マヨネーズ)   │
│  • Berhenti di marker section lain /         │
│    instruksi masak / barcode                  │
│  • Buang catatan alergen "(一部に…を含む)"    │
└─────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────┐
│ Tokenisasi + normalisasi                     │
│  • NFKC (full/half-width), lowercase,        │
│    buang tanda baca & spasi                  │
│  • Buang artefak border OCR ( | ｜ │ ┃ )      │
│  • Filter noise struktural (alamat, unit,    │
│    tanggal, perusahaan, instruksi)           │
│  • Strip prefix 添付/別添 (添付醤油 → 醤油)     │
└─────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────┐
│ Pencocokan 3 lapis (prioritas)               │
│  1. curated  — entri berlabel manusia        │
│  2. rules    — kata kunci (Layer 1b)         │
│  3. catalog  — nama OFF, status unknown      │
│                                             │
│  Exact dulu → fuzzy Levenshtein              │
│  • Panjang ≤2 char: exact saja               │
│    (cegah 豚肉/haram vs 牛肉 beda 1 huruf)   │
│  • E-number: exact saja                      │
│  • catalog: similarity ≥0.7                  │
│  • Buang kandidat unknown yang mirip dengan  │
│    hasil match kuat (dedup lintas-engine)    │
└─────────────────────────────────────────────┘
      │
      ▼
   Hasil per bahan
```

**Kenapa dua engine OCR?** ML Kit dan PaddleOCR punya pola salah yang berbeda —
saling melengkapi. Contoh nyata dari label yang sama:

| Bahan | ML Kit | PaddleOCR |
|---|---|---|
| 胡瓜酢漬 | `属酢漬` ❌ | `胡瓜酢漬` ✅ |
| 黒胡椒 | `黒胡織` ❌ | `黒胡椒` ✅ |
| 増粘多糖類 | `戦占多糖類` ❌ | `増粘多糖類` ✅ |
| レモン | `レモン` ✅ | `とモン` ❌ |
| 香辛料 | `香辛料` ✅ | `香辛米斗` ❌ |

Hasil keduanya digabung (union token), lalu duplikat/misread dibuang.

---

## 4. Sumber data

Semua sumber **terbuka / resmi**, tidak ada yang diekstrak dari aplikasi
komersial.

### 4.1 Nama bahan

| Sumber | Penyedia / Lembaga | Lisensi | Dipakai untuk |
|---|---|---|---|
| [Open Food Facts — instance Jepang](https://jp.openfoodfacts.org) | Open Food Facts (non-profit, Prancis) | ODbL | **10.805 nama bahan** (`src/data/catalog.json`): 5.619 dari taksonomi bahan + 5.186 surface form dari `ingredients_text` produk Jepang (39.404 produk) |
| Taksonomi bahan OFF | Open Food Facts | ODbL | Nama `ja`/`en`, E-number, sinyal `vegan`/`vegetarian`/`from_palm_oil` |

### 4.2 Nilai E-number (aditif)

| Sumber | Penyedia | Lisensi | Peran |
|---|---|---|---|
| **Food Additive Listing** | **MUIS — Majlis Ugama Islam Singapura** (badan pemerintah Singapura) | dokumen publik | **Arbiter.** Tanda `*` = "Syubhah / Doubtful"; tanpa tanda = tidak doubtful |
| e-number-halal-status | HalalLens (Norwegia) | CC-BY-4.0 | pembanding komunitas |
| E-Number-Database | SuhasDissa (GitHub) | GPL-3.0 | pembanding komunitas (dipakai internal, tidak di-*ship* mentah) |

Hasil merge: **796 E-number** (`src/data/ecodes.json`).

### 4.3 Sitasi / provenance

| Sumber | Penyedia | Lisensi | Peran |
|---|---|---|---|
| Halal Nutrition Food (RDF/API) | **ADDI Lab, ITS Surabaya** | ODbL | Provenance sertifikat: nama → lembaga penerbit sertifikat (MUI, IFANCC, JAKIM, ESMA, dll). **Bukan** tabel status bahan generik — hanya sitasi. 387 nama cocok (`src/data/addi-citations.json`) |

### 4.4 Rujukan fikih / regulasi

| Sumber | Penyedia | Dipakai untuk |
|---|---|---|
| Al-Qur'an (QS 2:173, 5:3, 5:90, 5:96, 6:145, 16:69, 16:115) | — | dasar haram/halal |
| LPPOM MUI (Lembaga Pemeriksa Halal, Indonesia) | MUI | kriteria bahan kritis, positive list |
| KMA No. 1360 Tahun 2021 | Kemenag RI / BPJPH | daftar bahan bebas kewajiban sertifikasi |
| JAKIM MS1500:2019 | JAKIM (Malaysia) | standar halal |
| EFSA / EU food additives | Uni Eropa | asal & fungsi aditif |

> Catatan: **LPPOM "Positive List" ≠ fatwa halal.** Artinya "bahan tidak kritis
> (bebas kewajiban sertifikasi)". Di aplikasi ini hal itu tidak ditampilkan
> sebagai "HALAL ✅".

---

## 5. Aturan klasifikasi & alasannya

### 5.1 Status

| Status | Arti |
|---|---|
| `halal` | Menurut aturan/rujukan yang dipakai, bahan ini boleh |
| `haram` | Secara eksplisit terlarang (babi, khamr, turunannya) |
| `syubhat` | Meragukan: sumber/proses tidak dapat dipastikan → **dihindari** |
| `unknown` | Nama dikenali, tapi belum diberi status ("Belum ditinjau") |

Setiap entri juga menyimpan **keyakinan** (`high`/`medium`/`low`) dan **dasar**
(`fiqh-rule`, `japan-label-rule`, `cross-source`, `single-source`, `conflict`,
`certification`, `origin-signal`).

### 5.2 Prinsip umum

1. **Asal hukumnya halal**; haram hanya bila ada dalil eksplisit.
2. **Bila ragu → syubhat** (prinsip syubhat: tinggalkan yang meragukan).
3. **Sumber yang menentukan.** Banyak bahan bisa halal atau haram tergantung
   asalnya (nabati vs babi). Tanpa keterangan → syubhat, bukan halal.

### 5.3 Aturan penting dan **kenapa** begitu

| Bahan / pola | Status | Alasan |
|---|---|---|
| `豚肉`, `ポーク`, `ラード`, `豚骨`, `ベーコン` | **haram** | Babi & turunannya haram eksplisit (QS 2:173, 5:3, 6:145, 16:115) |
| `日本酒`, `清酒`, `焼酎`, `洋酒` | **haram** | Khamr / minuman memabukkan (QS 5:90) |
| `牛肉`, `鶏肉`, `ラム肉` (daging) | **syubhat** | Halal **bila** disembelih syar'i. Di Jepang daging umumnya **tidak** disembelih syar'i, dan tanpa logo halal cara sembelih tak terjamin → syubhat |
| `ゼラチン`, `コラーゲン` | **syubhat** | Bisa dari babi (haram), sapi syar'i (halal), atau ikan. Tanpa keterangan sumber → syubhat |
| `レンネット`, `ペプシン`, `酵素`, `トランスグルタミナーゼ` | **syubhat** | Enzim bisa dari hewan (termasuk babi) atau mikroba |
| `L-システイン` / `システイン` | **syubhat** | Bisa dari rambut/bulu/plasma hewani, atau sintetis/mikroba |
| `乳化剤`, `モノグリセリド`, `グリセリン`, `ショートニング`, `マーガリン`, `ファットスプレッド`, `油脂加工品` | **syubhat** | Lemak/emulsifier bisa nabati (halal) atau hewani termasuk babi |
| `みりん`, `料理酒`, `酒粕`, `発酵調味料`, `たれ`, `ソース`, `ドレッシング` | **syubhat** | Bumbu berbasis alkohol/fermentasi; kadar & status diperdebatkan |
| `コチニール`, `カルミン` (E120) | **syubhat** | Pewarna dari serangga. **Ulama berbeda pendapat** — sebagian membolehkan, sebagian menghindari. Karena itu tidak dipaksa haram |
| `醤油`, `味噌` | **syubhat / halal low** | Produk fermentasi bisa mengandung residu alkohol |
| `乳`, `卵`, `バター`, `生クリーム`, `粉乳` | **halal (medium)** | Asalnya halal; waspada enzim/rennet pada olahannya |
| `大豆レシチン` | **halal** | Lesitin kedelai (nabati). Berbeda dengan `レシチン` generik → syubhat |
| Ikan & hasil laut (`魚`, `さば`, `えび`, `いか`, `海苔`) | **halal** | Mayoritas ulama: hasil laut halal (QS 5:96) |
| Nabati/mineral (`野菜`, `果実`, `食塩`, `砂糖`, `植物油脂`, `アミノ酸`, `クエン酸`, dll) | **halal** | Asal nabati/mineral |
| `酒粕` (sake lees) | **syubhat** | Turunan sake, bisa mengandung residu alkohol. Catatan: di Open Food Facts bisa ter-tag **vegan** — vegan hanya soal sumber hewani, **bukan** bebas alkohol |

### 5.4 Sinyal dari Open Food Facts (bukan verdict)

- `vegan=yes` → ditandai **halal dengan keyakinan `low`**, alasan eksplisit
  "kandidat, belum diverifikasi — masih mungkin ada alkohol/proses tidak halal".
- `vegetarian=yes` (tanpa vegan) → tetap `unknown` + catatan susu/telur.
- Karena prioritas `curated > rules > catalog`, sinyal vegan **tidak bisa**
  menutupi rule alkohol/mirin yang lebih tegas.

### 5.5 Arbitrase E-number

Urutan keputusan (lihat `scripts/build-ecodes.mjs`):

| Kondisi | Hasil |
|---|---|
| MUIS menandai syubhah | syubhat, keyakinan **high** |
| MUIS bersih + komunitas setuju | halal, high |
| MUIS bersih + komunitas meragukan | syubhat, medium (dasar `conflict`) |
| Tanpa MUIS, 2 sumber komunitas sepakat | status itu, high |
| Tanpa MUIS, sumber bentrok | syubhat, low (dasar `conflict`) |
| Hanya SuhasDissa | medium (perlu verifikasi) |
| Hanya HalalLens | **low** (dataset ini terbukti condong ke "halal") |

Prinsipnya: **jangan percaya satu sumber komunitas**. Contoh nyata: E120 —
HalalLens bilang *haram*, SuhasDissa bilang *halal* → aplikasi memilih
**syubhat** dan menampilkan kedua posisi.

---

## 6. Disclaimer (baca ini)

> ### ⚠️ ALAT BANTU PRIBADI — BUKAN SERTIFIKASI HALAL, BUKAN FATWA
>
> 1. Aplikasi ini **bukan** lembaga sertifikasi halal dan **tidak menerbitkan
>    sertifikat**. Status yang ditampilkan adalah **hasil penalaran otomatis +
>    riset pribadi**, bukan keputusan otoritas berwenang (LPPOM MUI, BPJPH, JAKIM,
>    MUIS, atau lembaga lain).
> 2. **Hasil OCR bisa salah.** Huruf kecil, kemasan melengkung, kilau, font
>    vertikal, dan kanji mirip sering salah baca. Selalu cek bagian
>    **"Teks mentah OCR"** dan **"Bagian yang dianalisis"**.
> 3. **Status `syubhat` BUKAN berarti haram**, dan **`halal` BUKAN jaminan produk
>    itu halal** — kontaminasi silang, proses produksi, dan perubahan formulasi
>    produsen tidak bisa dideteksi dari label saja.
> 4. **Data bisa berubah.** Produsen mengganti formulasi; standar lembaga
>    diperbarui. Database di sini adalah snapshot.
> 5. **Jangan jadikan dasar tunggal** untuk keputusan penting. Untuk kepastian:
>    cari **logo/sertifikat halal resmi** pada produk, atau tanyakan ke produsen /
>    lembaga sertifikasi.
> 6. **Bila ragu, tinggalkan** (prinsip syubhat). Aplikasi ini membantu
>    *menyaring*, bukan *menghalalkan*.
> 7. **Rujuk madzhab/scholar kamu.** Untuk kasus yang diperdebatkan (mis.
>    cochineal/E120, alkohol dalam bumbu), aplikasi ini menampilkan
>    **perbedaan pendapat**, bukan memilihkan fatwa untukmu.
>
> Tanggung jawab keputusan akhir ada pada pengguna.

---

## 7. Instalasi dari nol sampai jalan

### 7.1 Prasyarat

| Kebutuhan | Versi | Catatan |
|---|---|---|
| Node.js | ≥ 18 (diuji 22) | |
| npm | ≥ 10 | |
| JDK | **17 atau 21** | JDK 21 (Android Studio JBR) dipakai saat pengembangan. JDK 23 **tidak** cocok untuk Gradle 9 |
| Android SDK | platform-tools, build-tools, NDK, CMake | lewat Android Studio SDK Manager |
| Git | — | |

Catatan: `onnxruntime-react-native` + `@shopify/react-native-skia` adalah modul
native → **Expo Go tidak bisa dipakai**, wajib dev/prebuild build.

### 7.2 Clone & install dependency

```bash
git clone https://github.com/radhi223/personal_halal_scanner.git
cd personal_halal_scanner

# ERESOLVE dari peer expo-router: pakai legacy-peer-deps
npm install --legacy-peer-deps
```

`postinstall` otomatis menjalankan `scripts/fix-ort.mjs` yang mem-patch
`onnxruntime-react-native/android/build.gradle` (memperbaiki API `VersionNumber`
yang dihapus di Gradle 9). Kalau patch hilang setelah install ulang, jalankan:

```bash
node scripts/fix-ort.mjs
```

### 7.3 Generate project Android (CNG)

`android/` **tidak** ada di repo (Continuous Native Generation). Buat ulang:

```bash
npx expo prebuild --platform android --clean --no-install
```

Ini juga menjalankan config plugin lokal
`plugins/withOnnxruntimePackage.js` yang mendaftarkan `OnnxruntimePackage` ke
`MainApplication` (tanpa ini, `NativeModules.Onnxruntime` null → crash).

### 7.4 Build APK (lokal, gratis)

PowerShell:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:JAVA_HOME    = "C:\Program Files\Android\Android Studio\jbr"   # JDK 21
# opsional: taruh cache Gradle di drive lain
$env:GRADLE_USER_HOME = "D:\opencode\.gradle"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"

cd android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
```

- `-PreactNativeArchitectures=arm64-v8a` → APK jauh lebih kecil & cepat
  (±100 MB). Hapus flag ini kalau perangkat target bukan arm64.
- Hasil: `android/app/build/outputs/apk/release/app-release.apk`
- Release di-sign dengan debug keystore → cukup untuk sideload.

Build debug (butuh Metro): `.\gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a`

### 7.5 Install ke HP

**Cara A — USB (adb):**

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

**Cara B — manual:** copy APK ke HP → buka file → izinkan "Install unknown apps".

### 7.6 Build lewat EAS (opsional, cloud)

`eas.json` sudah menyediakan profil `development`, `preview` (APK), `production`.

```bash
npx eas-cli@latest login          # butuh akun Expo
npx eas-cli@latest build -p android --profile preview
```

### 7.7 Menjalankan (dev)

```bash
npx expo start --dev-client
```

Scan pertama memakai PaddleOCR → model PP-OCRv5 (±21 MB) **diunduh sekali** lalu
di-cache. Tanpa internet pada scan pertama, engine Paddle gagal dan otomatis
fallback ke ML Kit (tidak crash).

---

## 8. Development

```bash
npm run typecheck   # tsc --noEmit
npm run smoke       # 20 grup test (matcher, rules, OCR-varian, regression)
npm run lint        # expo lint
```

`npm run smoke` adalah jaring pengaman: setiap perbaikan OCR/rule ditambah
test-nya, supaya tuning tidak menimbulkan **false positive** (contoh nyata yang
pernah terjadi: `/ラム/` cocok dengan `グラム`, `/米/` cocok dengan alamat
`久米田`, `SoooN` cocok dengan `boron`).

### Script data (regenerasi database)

| Script | Fungsi |
|---|---|
| `scripts/harvest-off-jp.py` | Stream bulk export OFF → surface form bahan Jepang |
| `scripts/build-catalog.mjs` | Gabung taksonomi OFF + token JP → `src/data/catalog.json` |
| `scripts/build-ecodes.mjs` | Merge MUIS + 2 sumber komunitas → `src/data/ecodes.json` |
| `scripts/build-addi-citations.mjs` | Provenance sertifikat dari dump ADDI/ITS |
| `scripts/rank-jp-tokens.py` | Ranking frekuensi token di korpus produk Jepang |
| `scripts/gaps.ts` | Cross ranking × layer → daftar bahan yang belum berstatus |
| `scripts/fix-ort.mjs` | Patch Gradle ORT (dijalankan otomatis via `postinstall`) |

> ⚠️ Path data mentah (bulk export OFF, dump RDF ADDI) masih **hardcoded** ke
> direktori temp pengembang. Kalau menjalankan script di mesin lain, sesuaikan
> path di dalam script.

### Logging diagnostik

`src/lib/debug.ts` punya flag `DEBUG_VERBOSE`. Saat `true`, setiap scan menulis
detail ke logcat dengan prefix `HALALDBG` (dipakai untuk tuning OCR):

```bash
adb logcat -d | findstr HALALDBG
```

Set `false` untuk pemakaian normal.

---

## 9. Struktur project

```
src/
  app/                     # rute Expo Router
    _layout.tsx            # Stack navigator
    index.tsx              # Beranda
    scan.tsx               # Kamera/galeri → OCR → analisis
    result.tsx             # Hasil per bahan
    disclaimer.tsx         # Disclaimer
  lib/
    normalize.ts           # NFKC, tokenisasi, section 原材料名, filter noise/alamat
    rules.ts               # Layer 1b: 240 rule kata kunci
    matcher.ts             # Index, exact/fuzzy, prioritas 3 lapis, dedup
    levenshtein.ts         # Edit distance + similarity
    database.ts            # Load curated + catalog + sitasi ADDI
    ocr.ts                 # ML Kit (Japanese)
    ocrPaddle.ts           # PaddleOCR PP-OCRv5 (onnxruntime + Skia)
    scanStore.ts           # Handoff scan → hasil
    debug.ts               # Logging diagnostik (flag DEBUG_VERBOSE)
  data/
    ingredients.json       # 47 entri kurasi manual (termasuk Jepang-spesifik)
    ecodes.json            # 796 E-number (arbitrase MUIS)
    catalog.json           # 10.805 nama OFF (belum ditinjau)
    addi-citations.json    # 387 sitasi sertifikat
  types.ts                 # Skema entri (status, confidence, basis, sources)
  theme.ts
scripts/                   # Pipeline data + smoke test
plugins/withOnnxruntimePackage.js
metro.config.js            # assetExts += onnx
eas.json
app.json
```

---

## 10. Keterbatasan yang diketahui

- **Cakupan data** (berbobot frekuensi, top-800 token korpus JP): **85,4% punya
  verdict**, 11,9% noise non-makanan, **2,7% masih unknown**. Ekor panjang
  (≤12 kemunculan) belum dilabeli.
- **Sisa "unmatched"** umumnya fragmen OCR / instruksi masak / alamat, bukan
  bahan — ditampilkan apa adanya di bagian "Belum ada di database kami".
- **OCR masih salah** pada kanji mirip (`白部織` vs `白胡椒`, `増粘剤`), kana
  kecil, dan teks sangat kecil/melengkung.
- **Tuning rule punya plafon dan bisa non-monoton**: menambah pola bisa
  menurunkan `unmatched` di satu label tapi menaikkannya di label lain, atau
  memunculkan false positive. Karena itu setiap perubahan dikunci dengan test.
- **APK ±100 MB** karena membawa dua engine OCR (ML Kit + ONNX Runtime + Skia).
- Belum ada UI crop manual (untuk label yang sangat sulit) — rencana Phase
  berikutnya.
- Nama produk / nomor barcode **tidak** dinilai (hanya daftar bahan).

---

## 11. Lisensi & atribusi

Kode: lihat `LICENSE`.

Data pihak ketiga:

| Sumber | Lisensi | Kewajiban |
|---|---|---|
| Open Food Facts | ODbL 1.0 | atribusi + share-alike untuk database turunan |
| ADDI Lab / ITS Surabaya | ODbL 1.0 | atribusi |
| MUIS Food Additive Listing | dokumen publik pemerintah | sitasi |
| HalalLens e-number dataset | CC-BY-4.0 | atribusi ke https://halallens.no |
| SuhasDissa E-Number-Database | GPL-3.0 | dipakai **internal** sebagai pembanding (tidak di-*ship* mentah) |
| LPPOM MUI, JAKIM, EFSA | referensi | sitasi |

Aplikasi ini **tidak** mengambil, menyalin, atau mengekstrak database dari
aplikasi komersial mana pun.
