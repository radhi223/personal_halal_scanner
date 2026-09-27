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
  奶: '乳',
  浆: '漿',
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

/** Characters that end an ingredient item in the list. */
const LIST_SEPARATOR = /[、，,・/／]/;

/**
 * Metadata that must also end BACKWARD absorption (see absorbLeadingPrefix):
 * SECTION_STOP plus 種類別, whose value ("種類別: プロセスチーズ") is product
 * type, not list continuation, even though it is not a forward stop marker.
 */
const ABSORB_STOP = new RegExp(`(?:${SECTION_STOP.source}|種類別)`);

/**
 * Recover the leading ingredient list when the 原材料名 marker is found AFTER
 * the list has already started. Real labels (and PaddleOCR's flattened output,
 * which joins OCR lines with spaces) do this often: OCR reads the two-column
 * panel in an order where 小麦粉、ピザソース… lands before the header. The
 * first real-image golden set showed the old "start AT the marker" rule
 * silently dropping 14 items on fldb_4902410315353 (incl. ハム/チーズ).
 *
 * `pieces` are the OCR lines the marker was preceded by, followed by the
 * whitespace-split run before the marker on its own line. Walk backwards and
 * keep a piece when it is list-like:
 *   - it contains a list separator (、，,・/). Once one is seen the run is
 *     "anchored", and separator-free wrapped fragments before it are kept too
 *     (「食」+「塩」->「食塩」, 「マヨネー」+「ズ」->「マヨネーズ」).
 *   - before anchoring, a separator-free piece is kept only when the piece in
 *     front of it is list-like (a wrapped word such as 「レシ」 before
 *     「…ピザソ一ス、マヨ」).
 * Absorption stops at the first metadata piece (名称/品名/種類別/栄養成分/…),
 * so the product-name line and the nutrition block are never swallowed.
 */
function absorbLeadingPrefix(pieces: string[]): string {
  let keepFrom = pieces.length;
  let anchored = false;
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i];
    if (!piece) continue;
    if (ABSORB_STOP.test(piece)) break;
    if (LIST_SEPARATOR.test(piece)) {
      anchored = true;
      keepFrom = i;
      continue;
    }
    if (anchored) {
      keepFrom = i;
      continue;
    }
    let prev = i - 1;
    while (prev >= 0 && !pieces[prev]) prev--;
    if (prev >= 0 && !ABSORB_STOP.test(pieces[prev]) && LIST_SEPARATOR.test(pieces[prev])) {
      keepFrom = i;
      continue;
    }
    break;
  }
  return pieces.slice(keepFrom).filter(Boolean).join(' ');
}

/**
 * Isolate the 原材料名 (ingredient list) section from a full-label OCR blob.
 *
 * Photos usually capture the whole pack (product name, price, dates, nutrition,
 * maker, barcode). Matching against all of that is noisy, so we take only the
 * ingredient list. Lines are rejoined with NO separator because OCR wraps words
 * mid-ingredient (e.g. "マヨネー" + "ズ" -> "マヨネーズ"). The (flattened)
 * leading run recovered by absorbLeadingPrefix is space-joined instead so
 * separate OCR pieces stay separate; normalize() drops the spaces before
 * matching, so wrapped words still reassemble.
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

  // Recover ingredients listed before the marker: whole preceding OCR lines,
  // then the run before the marker on the marker line itself (which holds the
  // rest of the flattened text when the OCR service used `flatten: true`).
  const markerAt = lines[start].search(SECTION_START);
  const pieces: string[] = [];
  for (let i = 0; i < start; i++) pieces.push(lines[i]);
  for (const fragment of lines[start].slice(0, markerAt).split(/\s+/)) pieces.push(fragment);
  const leading = absorbLeadingPrefix(pieces);

  let collected = leading ? `${leading} ` : '';
  for (let i = start; i < lines.length; i++) {
    let line = lines[i];
    if (i === start) {
      // Drop only everything up to and including the marker, so OCR garbage
      // before it (e.g. "所材料名") is discarded and the list after it is kept.
      line = line.slice(markerAt).replace(SECTION_START, '');
    } else if (SECTION_STOP.test(line) || DIGITS_LINE.test(line.trim())) break;
    // Strip leading OCR noise (table borders / stray latin) on wrapped lines so
    // "|ズ" joins back onto the previous "マヨネー".
    line = line.replace(/^[|｜│┃lI1!)\]）(（\s]+/, '');
    collected += line;
  }

  // Drop allergen notes like "(一部に卵・乳成分・小麦・大豆・…を含む)".
  collected = collected.replace(/[(（][^()（）]*(含む|含まれ)[^()（）]*[)（）]/g, ' ');
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
    // Storage / process / origin boilerplate. Kept EXACT (not NOISE_RE) when a
    // substring would swallow a real ingredient: e.g. /殺菌/ would drop 殺菌液卵
    // (sterilised liquid egg) and /ブラジル/ would drop ブラジルナッツ.
    '殺菌', 'かやく',
    // Boilerplate seen leaking as "ingredients". EXACT only: 添加量 could sit
    // inside a real phrase, and 保存料 is a genuine additive class (handled by
    // the preservative2 rule) so it is deliberately NOT listed here.
    '添加量', '気密性容器', '每包裝所含食用分量數目',
    // Bare generic nouns that are never an ingredient by themselves. Kept EXACT
    // so prefixed forms (オニオンパウダー, カレーフィリング, 果汁ピューレ…)
    // still match normally: only the bare word is dropped.
    'あたり', 'パウダー', 'フィリング', 'ピューレ', '粉末', 'パック', 'ラベル', '粉末状',
    '容量', '固形量', '具材', 'トッピング', 'デザート', 'やくみ', 'ソテー', 'うきみ',
    'ガーナ', 'メキシコ', 'ベトナム', 'インド', '北海道',
    'g当たり', '当たり',
    // Country-of-origin names. EXACT only — never add to NOISE_RE: a substring
    // match would swallow real ingredients (チリ/チリパウダ, タイ/タイ(sea bream),
    // トルコ, etc.). The whole token must be just the country name.
    'カナダ', 'エチオピア', 'ニュージーランド', 'マレーシア', 'オーストラリア',
    'グアテマラ', 'インドネシア', 'スリランカ', 'ペルー', 'チリ', 'アルゼンチン',
    '南アフリカ', 'エジプト', 'トルコ', 'スペイン', 'イタリア', 'フランス', 'ドイツ',
    'オランダ', 'デンマーク', 'フィンランド', 'スウェーデン', 'ノルウェー', 'ポーランド',
    'ロシア', 'モロッコ', 'ケニア', 'フィリピン', 'マダガスカル', 'コスタリカ',
    'エクアドル', 'ウルグアイ', 'ボリビア', 'キューバ', 'ジャマイカ',
    '食品添加剤', '食品添加剂',
    // Ordinary Japanese words and government-guide/legal boilerplate that the
    // first real-image baseline (docs/VALIDATION_BASELINE.md) showed leaking
    // into findings, including FALSE VERDICTS from fuzzy matching: ただし ≈
    // 白だし, 加工所 ≈ 加工酢, 薬ラベル ≈ ミラベル. Kept EXACT (not NOISE_RE)
    // on purpose: several are common substrings of real ingredients
    // (保存 ⊂ 保存料, 由来 ⊂ 乳由来/大豆由来) so a substring pattern would
    // drop genuine tokens; the whole normalized token must equal the word.
    // Verified against curated names + rules: no curated name equals any of
    // these; the only substring hits are 保存 (保存料) and 由来 (乳化剤（大豆
    // 由来）, 米由来マグネシウム), which exact-only matching cannot swallow.
    'ただし', 'なお', 'また', '上記', '別表', '個別的', '定義', '方式', '規制',
    '事項', '止事項', '様式', '樣式', 'ポイント', '留意点', '該当', '加工所',
    '薬ラベル', '加工食品', '保存', '由来', '開封後', '記載', '表示', '別紙',
    '参考', '例示', '抜粋', '出典', '目次',
  ]
);

/**
 * Substring label-noise patterns. Two calibrated anchors:
 *  - フリー$ : only trailing "-free" claims (カフェインフリー, 糖類フリー,
 *    添加物フリー…) are noise. An unanchored フリー also dropped real words
 *    like フリーレンジ卵 (free-range egg) and フリーカット.
 *  - (?<!フリー)レンジ : still drops microwave instructions, but not the
 *    レンジ inside フリーレンジ卵.
 */
const NOISE_RE =
  /(税込|税抜|kcal|カロリー|製造|工場|株式会社|を含む|含まれ|不使用|無添加|フリー$|不含|一部に|賞味|期限|保存方法|栄養成分|たんばく質|タンパク質|脂質|炭水化物|食塩相当量|推定値|お問い合わせ|電話|原産|内容量|名称|品名|アレルギー|特定原材|注意|ください|目安|受付|発売元|製造元|造者|調理|加熱|(?<!フリー)レンジ|ハサミ|直射日光|高温多湿|ごみ|区分|記載|標準|存方法|エネルギー|原材|賞味期限|ます|です|外装|個包装|固包装|包装|パッケージ|画像|常温|高温|輸入者|販売元|南洋元|置いて|できま|トレイ|ハサミ|場合|一部|万全|不都合|本品|造場|表示値|表示值|インドネシ|保存法|タイ製造|発壳元|相談室|窓口|外袋|内袋|個装|枠外|記載|記勤|時簡|養成分|たんばく|たんはく|表目|前面|上部|国内製造|外国製造|遺伝子組換え|分別生産|生豆生産国|その他|産$|国$|国産|成分表示|ばく質|はく質|におい|合わせ先|合わ先|输入者|れません|灰水化物|熟量|熱量|表示|相当量|品質|材名|要冷蔵|要冷凍|風味原料)/;

/** Address / company / contact boilerplate (structural, not label-specific). */
const ADDRESS_RE =
  /(〒|tel|fax|電話|株式会社|有限会社|㈱|郵便|都|道|府|県|市|区|町|村|丁目|番地|番|号|通り|ビル)/;

/** Measurement units — only treated as noise when the token also has digits. */
const UNIT_RE = /(kca[l1i]?|kg|mg|ml|cm|mm|グラム|キロ|ミリ|%|個|袋|本|枚|g)/;

/**
 * OCR-soup guard. Merged tokens glue ingredient stems to a nutrition row or
 * measurement (e.g. "豆腐用凝固 部含 熱量78kca一蛋 牛"). Real ingredient names
 * never contain a nutrition word plus a number, so:
 *  - a digit is ALWAYS required (this keeps normal long compounds like
 *    植物油脂粉末調味料酒, たん白加水分解物 and 粉末状大豆たん白 untouched);
 *  - then either a nutrition fragment or ≥3 distinct food-class stems marks
 *    the token as several unrelated things glued together.
 * Deliberately conservative: length < 8 is never touched.
 */
const NUTRITION_IN_TOKEN_RE =
  /(熱量|カロリー|kcal|kca|エネルギー|たんぱく質|たん白質|脂質|炭水化物|食塩相当量)/;
/** Distinct food-class stems; ≥3 in one numbered token = several foods glued. */
const FOOD_STEM_RE =
  /(肉|魚|卵|乳|豆|麦|米|糖|塩|油|酢|酒|粉|茶|果|菜|エキス|たん白|蛋白|デンプン|でん粉|ビタミン|ミネラル)/g;

function isOcrSoup(normalized: string): boolean {
  if (normalized.length < 8) return false;
  if (!/\d/.test(normalized)) return false;
  if (NUTRITION_IN_TOKEN_RE.test(normalized)) return true;
  const stems = new Set(normalized.match(FOOD_STEM_RE) ?? []);
  return stems.size >= 3;
}

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
  if (isOcrSoup(normalized)) return true;
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

  // NB: ､ (half-width comma) and ｡ (half-width full stop) are included
  // literally — NFKC would fold them to 、/。, but the raw text is split BEFORE
  // normalization, so without them "赤ワイン､食塩" stayed a single token.
  const segments = text
    .split(/[\n\r、。，,．・/／|｜:：;；､｡()（）〔〕\[\]【】「」『』]+/)
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
