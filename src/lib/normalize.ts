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
 * Phrase-level OCR folds. Character folding cannot express these: the OCR read
 * a whole word wrong, not a single glyph. Every pair below was observed in a
 * real on-device scan (2026-09-27, 4 scans) and each one previously produced a
 * WRONG match:
 *  - 添味料/譲味料/翻味料 → 調味料 (seasoning). Without the fold the token was
 *    one character from 苦味料 (bitter agent) and matched it fuzzily.
 *  - カエでん粉/加エでん粉 → 加工でん粉 (modified starch). Without the fold the
 *    /でん粉/ halal rule won and the syubhat status was lost.
 *  - バーム油 → パーム油 (palm oil). Without the fold it fell through to an
 *    unreviewed catalog entry.
 * Folding is deterministic and exact, so it is strictly safer than widening the
 * fuzzy threshold. DB names are folded too, which is harmless (no curated name
 * equals a fold source).
 *
 * FIX-C (expanded dev set, 2026-10-03): every source string below was checked
 * against the curated ingredient + ecode names (src/data/ingredients.json,
 * ecodes.json), the catalog names (catalog.json) and the ranked JP token corpus
 * (jp-tokens-full.json, 5531 distinct tokens): ZERO occurrences. None of them
 * can be a real word, so each fold is unambiguous OCR garbage rather than a
 * vocabulary change. PHRASE_FOLD now runs AFTER whitespace removal, so a space
 * the OCR injected mid-word (ポ エキ) is bridged too.
 *  - ポ一ク -> ポーク, ポ一ペ一ス -> ポークペースト, ポエキ -> ポークエキス:
 *    off2_4562214820950 (GT ポークエキス / ポークペースト, haram). The long
 *    vowel was read as the kanji 一 and the OCR dropped ク/ス/ト; without the
 *    folds the split tokens produced NO finding and the pork never surfaced.
 *  - チンエキス -> チキンエキス: off2_4902165167887 (GT チキンエキス調味料,
 *    syubhat). OCR dropped キ; the token then fell to the generic /調味料/
 *    halal rule instead of the earlier animal-extract rule.
 *  - ビ一工ス -> ビーフエキス: off2_4903110526209 (GT ビーフエキス調味料,
 *    syubhat). ー->一 and エ->工 with フ/キ dropped; same generic-seasoning
 *    shadowing as above.
 *  - 加工次增粘多理规查料着鱼料 -> 加工デンプン: off2_4903308060904 (GT
 *    安定剤（加工デンプン、増粘多糖類）, syubhat). The whole modified-starch
 *    chunk was shredded by the strip-recovery OCR; without the fold the generic
 *    /増粘/ halal thickener rule (thickener2) claimed it. Folding to the
 *    curated 加工デンプン name restores the syubhat verdict.
 */
const PHRASE_FOLD: [string, string][] = [
  ['添味料', '調味料'],
  ['譲味料', '調味料'],
  ['翻味料', '調味料'],
  ['諏味料', '調味料'],
  ['カエでん粉', '加工でん粉'],
  ['加エでん粉', '加工でん粉'],
  ['バーム油', 'パーム油'],
  // カ->力 (and オ->扱) garble: OCR read カツオ as カツ扱 / 力ツ扱 in
  // fldb_4901313207604. Without the fold the token hit the meat-cut rule
  // (/カツ/) and bonito — a FISH — was flagged as an unidentified meat cut.
  ['力ツ扱', 'カツオ'],
  ['カツ扱', 'カツオ'],
  // FIX-C pork/animal-extract seasonings (evidence in the block comment above).
  ['ポ一ペ一ス', 'ポークペースト'],
  ['ポ一ク', 'ポーク'],
  ['ポエキ', 'ポークエキス'],
  ['チンエキス', 'チキンエキス'],
  ['ビ一工ス', 'ビーフエキス'],
  // FIX-C shredded modified-starch (pre-VARIANT form: 增 not 増).
  ['加工次增粘多理规查料着鱼料', '加工デンプン'],
];

/**
 * Canonical form: NFKC (full-width -> half-width, half-width katakana -> full),
 * whitespace stripped, phrase-folded, variant CJK folded, lowercased,
 * punctuation stripped.
 *
 * Whitespace is removed BEFORE the phrase folds: OCR frequently injects a space
 * into the middle of a single word (ポ エキ, たん白 加水分解物), and the fold
 * sources are whole phrases. Folding also runs before variant CJK folding, so
 * fold sources use the raw OCR characters (增, not the folded 増).
 */
export function normalize(input: string): string {
  if (!input) return '';
  let s = input.normalize('NFKC');
  s = s.replace(WHITESPACE, '');
  for (const [from, to] of PHRASE_FOLD) {
    if (s.includes(from)) s = s.split(from).join(to);
  }
  s = s.replace(VARIANT_RE, (c) => VARIANT_FOLD[c]);
  s = s.toLowerCase();
  s = s.replace(JP_PUNCTUATION, '');
  s = s.replace(PUNCTUATION, '');
  return s;
}

/**
 * Section header for the ingredient list. Includes OCR-mangled variants we have
 * actually observed on-device, e.g. 原材料名 read as 所材料名 / 原材料 / 材料名.
 */
const SECTION_START = /(原材料名|原材料|原料名|原材名|材料名|材料|料名|ingredients?\s*[:：])/i;
/** Markers that begin a DIFFERENT section, so we stop collecting. */
const SECTION_STOP =
  /(栄養成分|栄養成分表示|製造者|製造所|販売者|加工者|輸入者|名称|品名|賞味期限|消費期限|保存方法|内容量|税込|税抜|アレルギー|特定原材|原産国|原産地|お問い合わせ|お客様相談|電話|〒|推定値|熱量|たんぱく質|たんばく質|脂質|炭水化物|食塩相当量|JAN|調理|切る|注意|ください|電子レンジ|レンジ|加熱|ハサミ|直射日光|高温多湿|発売元|製造元|受付|目安|表示値|ごみ|記載|存方法|造者|時簡|養成分|たんばく|外袋|内袋|個装|枠外|表目|前面|上部|記勤|NUTRITION\s*FACTS|%\s*Daily|CONTAINS\b|SERVING\s*SIZE|CALORIES|MANUFACTUR|DISTRIBUTED|CERTIFIED|TRADEMARK|SOLD\s*BY\s*WEIGHT)/i;
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
 * English-label support. OFF labels (e.g. off_0041143029329) flatten a whole
 * panel into one Latin run where the ingredient list sits beside a garbled
 * nutrition block ("DerservngCalories", "NOTACALORIE", "Serving Size"). The
 * Japanese section markers never match, so extractIngredientSection returns the
 * whole blob. When the recovered section is Latin-dominant, cut it at the first
 * garbled nutrition marker so only the (earlier) ingredient portion survives.
 * A Japanese-dominant section is never touched.
 */
const GARBLED_NUTRITION_RE = /alor|utrition|ervin|aily|alorie/i;
function isLatinDominant(text: string): boolean {
  const compact = text.replace(/\s/g, '');
  if (!compact) return false;
  const ascii = compact.replace(/[^\x20-\x7e]/g, '').length;
  return ascii / compact.length > 0.7;
}
/** Trim a Latin-dominant section at the first garbled nutrition marker. */
function applyLatinNutritionFallback(section: string): string {
  if (!isLatinDominant(section)) return section;
  const cut = section.search(GARBLED_NUTRITION_RE);
  return cut > 0 ? section.slice(0, cut).trim() : section;
}

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
  if (start === -1) return applyLatinNutritionFallback(text);

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
  collected = collected.replace(/^[、,\s。]+/, '').trim();

  // English-label fallback: Latin-dominant section that still carries a garbled
  // nutrition header -> keep only what precedes it. (Also applied on the
  // no-marker return path above.)
  return applyLatinNutritionFallback(collected);
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
    // Measured boilerplate leaks on the label corpus (~18-38 tokens). Kept
    // EXACT (and duplicated in NOISE_RE only where a substring cannot hit a real
    // ingredient): bare 側面/表面 would swallow genuine words, so only the full
    // 側面記 form is listed. 開封後 / 記載 / 表示 already appear above.
    '召し上がり', '買い上げ', '購入日', '天面', '側面記', '平日', '午前',
    '午後', 'サービス係', '健康補助食品', '問合せ', '問い合せ', '造りては',
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
  /(税込|税抜|kcal|カロリー|製造|工場|株式会社|を含む|含まれ|不使用|無添加|フリー$|不含|一部に|賞味|期限|保存方法|栄養成分|たんばく質|タンパク質|脂質|炭水化物|食塩相当量|推定値|お問い合わせ|電話|原産|内容量|名称|品名|アレルギー|特定原材|注意|ください|目安|受付|発売元|製造元|造者|調理|加熱|(?<!フリー)レンジ|ハサミ|直射日光|高温多湿|ごみ|区分|記載|標準|存方法|エネルギー|原材|賞味期限|ます|です|外装|個包装|固包装|包装|パッケージ|画像|常温|高温|輸入者|販売元|南洋元|置いて|できま|トレイ|ハサミ|場合|一部|万全|不都合|本品|造場|表示値|表示值|インドネシ|保存法|タイ製造|発壳元|相談室|窓口|外袋|内袋|個装|枠外|記載|記勤|時簡|養成分|たんばく|たんはく|表目|前面|上部|国内製造|外国製造|遺伝子組換え|分別生産|生豆生産国|その他|産$|国$|国産|成分表示|ばく質|はく質|におい|合わせ先|合わ先|输入者|れません|灰水化物|熟量|熱量|表示|相当量|品質|材名|要冷蔵|要冷凍|風味原料|召し上が|買い上げ|購入日|天面|側面記|平日|午前|午後|サービス係|健康補助食品|問合せ|問い合せ|造りては|開封後)/;

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
  // Threshold lowered 3 -> 2 after a real on-device scan (2026-09-27) merged a
  // nutrition row into an ingredient: "水 化 物 6.4 大豆 粉" normalized to
  // 水化物6.4大豆粉 (2 stems: 豆, 粉) and matched the /大豆/ halal rule. Real
  // ingredient names never contain digits, so a numbered token with two
  // food-class stems is always glued table text.
  return stems.size >= 2;
}

/**
 * Allergen declaration boilerplate ("一部に卵・乳成分・小麦・大豆を含む"), often
 * OCR-garbled to 部仁…を含t. This is a declaration, not an ingredient: the real
 * ingredients are already listed separately in the 原材料名 list, so leaving it
 * in produced a bogus finding (device scan 2026-09-27 matched the garbled
 * string to the egg rule and printed "halal").
 *
 * Guard: drop the token only when it carries a boilerplate marker AND names at
 * least two allergens, and NEVER when it names a meat species — a declaration
 * that mentions 豚肉/鶏肉/牛肉/ゼラチン is a genuine (and high-stakes) signal
 * that must keep flowing to the meat rules.
 */
const ALLERGEN_BOILERPLATE_RE = /(一部に|部仁|を含)/;
const ALLERGEN_WORD_RE =
  /(卵|乳成分|小麦|そば|落花生|えび|かに|オレンジ|キウイ|バナナ|もも|りんご|ゼラチン|大豆)/g;
const MEAT_SPECIES = '(豚|鶏|牛|羊|ラード|ポーク|チキン|ビーフ|ゼラチン)';
/** Non-global: safe for repeated .test(). */
const MEAT_SPECIES_RE = new RegExp(MEAT_SPECIES);
/** Global: for counting how many different animal ingredients a token names. */
const MEAT_SPECIES_RE_G = new RegExp(MEAT_SPECIES, 'g');

/**
 * Non-ingredient mention patterns. A meat word inside one of these is a statement
 * about equipment, a possibility, or a NEGATION — never an ingredient claim.
 *
 * Hard-won constraints (verifier rounds 3-4, 2026-09-27):
 *  - Bare 使用 / 使った / 製品 are POSITIVE claims ("牛肉を使用した調味料",
 *    "ゼラチン使用", "豚肉製品") and must reach the meat rules.
 *  - Bare 製造 / 工場 are substrings of real ingredient names ("製造用豚肉エキ
 *    ス", "豚肉工場製造", "工場直送豚肉"), so they only count inside a verb
 *    phrase ("製造しています") or an explicit locative ("工場では").
 *  - なし must not fire inside 洋なし (pear).
 *  - Inflections matter: 使っていない / 使ってない / 使わない / 使用しない /
 *    含まない / 添加していない / 配合していない / ことはない / おりません all
 *    occur on real labels.
 */
const NON_INGREDIENT_MENTION_RE = new RegExp(
  [
    // equipment / facility (phrase-level only)
    '設備',
    '工場(では|にて|において)',
    '製造(しています|しました|している|された)',
    '取り扱(う|っ|い|き)',
    '扱(う|っ|い|き)',
    // possibility / contamination
    '場合(が|も)あります',
    '可能性があります',
    'ことが(あり|ござい)ます',
    '事が(あり|ござい)ます',
    'ケースがあります',
    '恐れがあります',
    'おそれがあります',
    '稀にあります',
    'かもしれません',
    '混入',
    // negation
    '(使って|使われて|使用して|使用されて|添加して|添加されて|配合して|配合されて|含んで|含まれて|入って|されて)(い)?(ない|ません|なかった)',
    '(使って|使われて|使用して|使用されて|添加して|添加されて|配合して|配合されて|含んで|含まれて|入って|されて)おりません',
    '(使い|使用し|添加し|配合し|含み|入り)ません',
    '(使わ|使用し|添加し|配合し|含ま|入ら)ない',
    '(使う|含む|使われる|添加する|配合する|入る)ことは(ない|ありません|ございません)',
    '原料としていません',
    '無(豚|牛|鶏|羊|肉|ポーク|チキン|ビーフ|ラード|ゼラチン)',
    '未使用',
    '未添加',
    '不使用',
    '不添加',
    '無添加',
    '不含',
    '含まず',
    '使わず',
    'ノン',
    'ありません',
    'フリー',
    'ゼロ',
    '除去',
    '取扱',
    '(?<!洋)なし',
  ].join('|')
);

function isAllergenBoilerplate(normalized: string): boolean {
  if (!ALLERGEN_BOILERPLATE_RE.test(normalized)) return false;
  if (MEAT_SPECIES_RE.test(normalized)) return false;
  const allergens = new Set(normalized.match(ALLERGEN_WORD_RE) ?? []);
  return allergens.size >= 2;
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
  // A meat word needs care: it is either a real ingredient claim or a statement
  // about the factory / a possibility / an explicit negation.
  //  - "一部に豚肉を含む" is a genuine claim and must reach the pork rule
  //    (NOISE_RE's 一部に/を含む used to swallow it silently).
  //  - "豚肉を含む製品を製造しています", "豚肉を使った設備", "豚肉は入ってい
  //    ません" are not ingredient claims and must never be reported as haram.
  if (MEAT_SPECIES_RE.test(normalized)) {
    // Drop the token ONLY when it mentions the animal exactly ONCE and carries a
    // non-claim marker. Two mentions ("豚肉不使用の豚肉エキス入り",
    // "豚肉を使っていないが豚肉エキスは入っている") mean a negation and a
    // positive claim share one token — the claim must win, otherwise the pork
    // disappears and the banner goes green (verifier rounds 4-5).
    const mentions = [...normalized.matchAll(MEAT_SPECIES_RE_G)];
    if (mentions.length === 1 && NON_INGREDIENT_MENTION_RE.test(normalized)) return true;
    // Everything else is an ingredient claim. NOISE_RE's 製造/工場/不使用
    // substrings must NOT swallow it: 製造用豚肉エキス, 豚肉工場製造,
    // 工場直送豚肉, 牛肉を製造工程で使用 and 豚肉不使用のラード入り食品 were all
    // silently deleted this way (verifier round 4) — a green banner beside halal
    // items while a pork/lard claim sat in the list.
    if (isOcrSoup(normalized)) return true;
    if (/\d/.test(normalized) && UNIT_RE.test(normalized)) return true;
    return false;
  }
  if (NOISE_EXACT.has(normalized)) return true;
  if (NOISE_RE.test(normalized)) return true;
  if (ADDRESS_RE.test(normalized)) return true;
  if (/\d/.test(normalized) && UNIT_RE.test(normalized)) return true;
  if (isOcrSoup(normalized)) return true;
  if (isAllergenBoilerplate(normalized)) return true;
  if (/^[¥￥$]?\d/.test(normalized)) return true; // prices / quantities / dates
  if (/^\d+$/.test(normalized)) return true;
  return false;
}

/**
 * Real single-character ingredients that OCR emits as their own token and that
 * the generic length guard below would otherwise drop (GT 卵 on
 * fldb_4902410315353). Kept EXACT and only when the token is standalone: no
 * substring mining, so 水 / 肉 and every other single char stay dropped.
 */
export const SINGLE_CHAR_KEEP = new Set(['卵', '米', '酢', '塩', '油', '乳', '魚']);

/**
 * "着色料（ウコン）" / "色素(カラメル)": the normal paren split produces the
 * generic 着色料 (syubhat) plus the bare name, so the named-colorant rule never
 * sees the pair. Emit the inner name AND the joined form (着色料ウコン) as
 * candidates too; the plain split is kept unchanged.
 */
const COMBINED_COLORANT_RE = /(?:着色料|色素)[（(]([^（）()]{2,30})[）)]/g;

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

  // A compound line can mix a negated and a positive claim
  // ("ゼラチン不使用だが豚肉エキス使用"). Split on conjunctions so each half is
  // judged on its own instead of the negation swallowing the pork mention.
  text = text.replace(/(だが|しかし|けれど|けど|ただし)/g, '、');

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
    // Single chars are too noisy to match, except the real standalone
    // ingredients whitelisted above.
    if (t.length < 2 && !SINGLE_CHAR_KEEP.has(t)) return;
    const key = normalize(t);
    if (!key || seen.has(key)) return;
    if (isLabelNoise(key)) return; // drop label metadata (tax/dates/nutrition/maker)
    seen.add(key);
    out.push(t);
  };

  // Named colorant in parentheses: add the inner name and the joined form
  // BEFORE the normal split so the named-colorant rule can fire on the pair.
  for (const m of text.matchAll(COMBINED_COLORANT_RE)) {
    const inner = m[1].trim();
    if (!inner) continue;
    push(inner);
    push(m[0].replace(/[（(][\s\S]*$/, '') + inner);
  }

  for (const segment of segments) {
    push(segment);
    // Sub-parts ARE mined even from a glued OCR-soup segment, on purpose.
    // A golden-set image (off_4517888131963) has "...(加工でん粉) 豆腐用凝固
    // 部含 熱量78kca一蛋 牛" — a nutrition row merged onto the list — and
    // 豆腐用凝固 only survives because the segment's space-separated pieces are
    // kept. Skipping them (tried 2026-09-27) silently deleted that syubhat
    // ingredient. The cost is the occasional junk sub-part from a nutrition row
    // (水 化 物 6.4 大豆 粉 -> 大豆), which only ever reports a real ingredient's
    // correct status and cannot mask a hazard.
    const parts = segment.split(WHITESPACE);
    if (parts.length > 1) {
      for (const part of parts) push(part);
    }
  }

  return out;
}
