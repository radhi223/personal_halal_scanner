/**
 * Text normalization for OCR output.
 *
 * Japanese labels mix full-width and half-width characters, and OCR adds
 * punctuation/whitespace noise. Normalizing both the OCR token and the
 * database term to the same canonical form is what makes fuzzy matching work.
 */

const PUNCTUATION = /[.,:;!?'"`~^*_\-–—/\\|+=<>@#$%&]+/g;
const JP_PUNCTUATION = /[・、。，．！？「」『』【】（）〔〕［］｛｝]+/g;
const WHITESPACE = /[\s\u3000]+/g;

/**
 * Simplified / variant CJK characters -> the Japanese shinjitai we store.
 * OCR (and Chinese-influenced labels) emit these; folding them is deterministic
 * and safe, unlike loosening fuzzy thresholds.
 * e.g. 酸化防止剂 -> 酸化防止剤, 酱油 -> 醤油, 多糖类 -> 多糖類
 */
const VARIANT_FOLD: Record<string, string> = {
  酱: '醤',
  剂: '剤',
  类: '類',
  增: '増',
  质: '質',
  盐: '塩',
  发: '発',
  变: '変',
  淀: '澱',
  铁: '鉄',
  银: '銀',
  铜: '銅',
  铅: '鉛',
  纤: '繊',
  蛋: '卵',
  奶: '乳',
};

const VARIANT_RE = new RegExp(`[${Object.keys(VARIANT_FOLD).join('')}]`, 'g');

/**
 * Canonical form: NFKC (full-width -> half-width, half-width katakana -> full),
 * variant CJK folded, lowercased, punctuation and whitespace stripped.
 */
export function normalize(input: string): string {
  if (!input) return '';
  let s = input.normalize('NFKC');
  s = s.replace(VARIANT_RE, (c) => VARIANT_FOLD[c]);
  s = s.toLowerCase();
  s = s.replace(WHITESPACE, '');
  s = s.replace(JP_PUNCTUATION, '');
  s = s.replace(PUNCTUATION, '');
  return s;
}

/**
 * Section header for the ingredient list. Includes OCR-mangled variants we have
 * actually observed on-device, e.g. 原材料名 read as 所材料名 / 原材料 / 材料名.
 */
const SECTION_START = /(原材料名|原材料|原料名|原材名|材料名|材料|料名)/;
/** Markers that begin a DIFFERENT section, so we stop collecting. */
const SECTION_STOP =
  /(栄養成分|栄養成分表示|製造者|製造所|販売者|加工者|輸入者|名称|品名|賞味期限|消費期限|保存方法|内容量|税込|税抜|アレルギー|特定原材|原産国|原産地|お問い合わせ|お客様相談|電話|〒|推定値|熱量|たんぱく質|たんばく質|脂質|炭水化物|食塩相当量|JAN|調理|切る|注意|ください|電子レンジ|レンジ|加熱|ハサミ|直射日光|高温多湿|発売元|製造元|受付|目安|表示値|ごみ|記載|存方法|造者|時簡|養成分|たんばく|外袋|内袋|個装|枠外|表目|前面|上部|記勤)/;
/** A line that is basically just a barcode / long digit run. */
const DIGITS_LINE = /^[\d\s\-ー－]{8,}$/;

/**
 * Isolate the 原材料名 (ingredient list) section from a full-label OCR blob.
 *
 * Photos usually capture the whole pack (product name, price, dates, nutrition,
 * maker, barcode). Matching against all of that is noisy, so we take only the
 * ingredient list. Lines are rejoined with NO separator because OCR wraps words
 * mid-ingredient (e.g. "マヨネー" + "ズ" -> "マヨネーズ").
 *
 * Falls back to the full text when no 原材料名 marker is found.
 */
export function extractIngredientSection(text: string): string {
  if (!text) return '';
  const lines = text.split(/\r?\n/);

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_START.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return text;

  let collected = '';
  for (let i = start; i < lines.length; i++) {
    let line = lines[i];
    if (i === start) {
      // Drop everything up to and including the marker, so OCR garbage before it
      // (e.g. "所材料名") is discarded too.
      line = line.replace(/^.*?(原材料名|原材料|原料名|原材名|材料名|材料|料名)/, '');
    } else if (SECTION_STOP.test(line) || DIGITS_LINE.test(line.trim())) break;
    // Strip leading OCR noise (table borders / stray latin) on wrapped lines so
    // "|ズ" joins back onto the previous "マヨネー".
    line = line.replace(/^[|｜│┃lI1!)\]）(（\s]+/, '');
    collected += line;
  }

  // Drop allergen notes like "(一部に卵・乳成分・小麦・大豆・…を含む)".
  collected = collected.replace(/[(（][^()（）]*(含む|含まれ)[^()（）]*[)）]/g, ' ');
  return collected.replace(/^[、,\s。]+/, '').trim();
}

/**
 * Label metadata that is NOT an ingredient (tax, dates, nutrition, maker,
 * origin, allergen boilerplate). Matching these produces useless "belum
 * ditinjau" cards, so they are dropped before matching.
 */
const NOISE_EXACT = new Set(
  [
    '税込', '税抜', '名称', '品名', '内容量', '賞味期限', '消費期限', '保存方法',
    '原材料名', '原材料', '原料', '材料名', '製造者', '販売者', '製造所', '加工者',
    '輸入者', '栄養成分', '栄養成分表示', '熱量', 'たんぱく質', 'タンパク質', '脂質',
    '炭水化物', '食塩相当量', '推定値', 'アレルギー', '特定原材料', '原産国', '原産地',
    'お問い合わせ', '賞味', '期限', '国産', '国内製造', '輸入', '添加物',
    'ます', 'です', '外装', '個包装', '固包装', '包装', 'パッケージ', '画像',
    '常温', '高温', '輸入者', '販売元', '南洋元', '場合', 'トレイ', 'ハサミ', '端',
    '万全', '不都合', '成分', '本品', '表示値', 'インドネシ',
    '成分表示', '保存法', 'タイ製造', 'タイ産', '発壳元', '相談室', '窓口', 'パツ', '牛式会社',
    '外袋', '内袋', '個装', '枠外', '記載', '時簡', '養成分', 'たんばく', '表目',
    '国内製造', '国産', 'その他', '外国製造', '輸入', '日本', 'アメリカ', '中国',
    '北海道産', 'ブラジル', '米国産', '国産米使用', '遺伝子組換えでない', '生豆生産国名',
    '未満', 'コロンビア', '国産米', '国内', 'プラ',
  ]
);

const NOISE_RE =
  /(税込|税抜|kcal|カロリー|製造|工場|株式会社|を含む|含まれ|一部に|賞味|期限|保存方法|栄養成分|たんぱく質|たんばく質|タンパク質|脂質|炭水化物|食塩相当量|推定値|お問い合わせ|電話|原産|内容量|名称|品名|アレルギー|特定原材|注意|ください|目安|受付|発売元|製造元|造者|調理|加熱|レンジ|ハサミ|直射日光|高温多湿|ごみ|区分|記載|標準|存方法|エネルギー|原材|賞味期限|ます|です|外装|個包装|固包装|包装|パッケージ|画像|常温|高温|輸入者|販売元|南洋元|置いて|できま|トレイ|ハサミ|場合|一部|万全|不都合|本品|造場|表示値|表示值|インドネシ|保存法|タイ製造|発壳元|相談室|窓口|外袋|内袋|個装|枠外|記載|記勤|時簡|養成分|たんばく|たんはく|表目|前面|上部|国内製造|外国製造|遺伝子組換え|分別生産|生豆生産国|その他|産$|国$|国産|成分表示|ばく質|はく質|におい|合わせ先|合わ先|输入者|れません|灰水化物|熟量|表示|相当量|品質|材名)/;

/** Address / company / contact boilerplate (structural, not label-specific). */
const ADDRESS_RE =
  /(〒|tel|fax|電話|株式会社|有限会社|㈱|郵便|都|道|府|県|市|区|町|村|丁目|番地|番|号|通り|ビル)/;

/** Measurement units — only treated as noise when the token also has digits. */
const UNIT_RE = /(kcal|kg|mg|ml|cm|mm|グラム|キロ|ミリ|%|個|袋|本|枚|g)/;

/** True if a text line looks like the ingredient-list header (原材料名 variants). */
export function isIngredientHeader(text: string): boolean {
  return SECTION_START.test(text ?? '');
}

/** True if a text line starts a different section (so the ingredient list ended). */
export function isSectionBoundary(text: string): boolean {
  return SECTION_STOP.test(text ?? '');
}

/**
 * Stricter boundary used when CROPPING: the marker must be at the START of the
 * line. Ingredient lines often *contain* nutrition words mid-line (e.g.
 * "調味料(…、植物性たんぱく質)"), and stopping there truncates the list.
 */
const CROP_BOUNDARY =
  /^\s*(栄養成分|栄養成分表示|製造者|製造所|販売者|加工者|輸入者|名称|品名|賞味期限|消費期限|保存方法|内容量|税込|税抜|アレルギー|特定原材|原産国|原産地|お問い合わせ|お客様相談|電話|〒|推定値|熱量|たんぱく質|脂質|炭水化物|食塩相当量|JAN|調理|作り方|加熱|電子レンジ|レンジ|注意|ください|開封|保存)/;

/** Boundary check for cropping (anchored at line start). */
export function isCropBoundary(text: string): boolean {
  return CROP_BOUNDARY.test(text ?? '');
}

/** True if a normalized token is label metadata rather than an ingredient. */
export function isLabelNoise(normalized: string): boolean {
  if (!normalized) return true;
  if (NOISE_EXACT.has(normalized)) return true;
  if (NOISE_RE.test(normalized)) return true;
  if (ADDRESS_RE.test(normalized)) return true;
  if (/\d/.test(normalized) && UNIT_RE.test(normalized)) return true;
  if (/^[¥￥$]?\d/.test(normalized)) return true; // prices / quantities / dates
  if (/^\d+$/.test(normalized)) return true;
  return false;
}

/**
 * Split a raw OCR blob into candidate ingredient tokens.
 *
 * Ingredients on Japanese labels are separated by Japanese commas/中黒,
 * newlines, slashes, and parentheses. We return unique candidates, keeping
 * both the full segment and its space-separated sub-parts.
 */
export function extractCandidates(text: string): string[] {
  if (!text) return [];

  // OCR often injects table-border characters into the middle of words
  // (e.g. マヨネ + "|" + ズ). Drop them so the word can reassemble.
  text = text.replace(/[|｜│┃]/g, '');

  const segments = text
    .split(/[\n\r、。，,．・/／|｜:：;；()（）〔〕\[\]【】「」『』]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const out: string[] = [];
  const seen = new Set<string>();

  const push = (value: string) => {
    // Strip "attached/separate" packaging prefixes so 添付醤油 -> 醤油.
    const t = value.trim().replace(/^(添付|別添|付属|添付調味)/, '');
    if (t.length < 2) return; // single chars are too noisy to match
    const key = normalize(t);
    if (!key || seen.has(key)) return;
    if (isLabelNoise(key)) return; // drop label metadata (tax/dates/nutrition/maker)
    seen.add(key);
    out.push(t);
  };

  for (const segment of segments) {
    push(segment);
    const parts = segment.split(WHITESPACE);
    if (parts.length > 1) {
      for (const part of parts) push(part);
    }
  }

  return out;
}
