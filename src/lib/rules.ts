import type { Basis, Confidence, HalalStatus, IngredientEntry, MatchResult } from '@/types';

/**
 * Layer 1b: keyword curation rules.
 *
 * These catch label wordings that never appear in ingredient datasets (Japanese
 * local naming like 動物性エキス or 料理酒) and act as a fallback when the
 * curated table has no exact entry. Rules run on NORMALIZED text (see
 * normalize.ts: lowercased, punctuation/space stripped), so patterns are plain
 * substrings.
 *
 * Order matters: more specific rules must come first. The generic エキス rule is
 * deliberately last among extracts — a curated exact entry (e.g. 酵母エキス,
 * halal) is matched before rules are consulted, so it is never overridden.
 */
export interface CurationRule {
  id: string;
  label: string;
  status: HalalStatus;
  confidence: Confidence;
  category: string;
  patterns: RegExp[];
  reasoning: string;
  sources: string[];
  /** Defaults to 'japan-label-rule' when omitted. */
  basis?: Basis;
}

/** Shorthand for the many "common, clearly plant/mineral" ingredient rules. */
function halalRule(
  id: string,
  label: string,
  patterns: RegExp[],
  category: string,
  reasoning: string,
  confidence: Confidence = 'high'
): CurationRule {
  return {
    id,
    label,
    status: 'halal',
    confidence,
    category,
    patterns,
    reasoning,
    sources: ['LPPOM MUI — bahan nabati/mineral', 'JAKIM MS1500:2019'],
  };
}

const LPPOM = 'LPPOM MUI — kriteria bahan';
const JAKIM = 'JAKIM MS1500:2019';

export const CURATION_RULES: CurationRule[] = [
  {
    id: 'sake',
    label: 'Sake / 清酒',
    status: 'haram',
    confidence: 'high',
    category: 'alcohol',
    patterns: [/日本酒/, /清酒/, /せいしゅ/],
    reasoning:
      'Sake/清酒 adalah minuman khamr berbasis beras yang memabukkan, haram.',
    sources: ["QS Al-Maa'idah 5:90", LPPOM],
  },
  {
    id: 'rum',
    label: 'Rum / ラム酒',
    status: 'haram',
    confidence: 'high',
    category: 'alcohol',
    // NB: never bare /ラム/ — it matches グラム (gram) and ラム肉 (lamb, syubhat).
    patterns: [/ラム酒/],
    reasoning: 'ラム酒 (rum) adalah minuman beralkohol (khamr) hasil sulingan, haram.',
    sources: ["QS Al-Maa'idah 5:90", LPPOM],
  },
  {
    id: 'sweet-fruit-wine',
    label: 'Sweet fruit wine / 甘味果実酒',
    status: 'haram',
    confidence: 'high',
    category: 'alcohol',
    // Must precede the generic halal /果実/ (fruit) rule: 果実酒/果実酒類 are
    // fermented fruit wine (khamr), NOT plain fruit.
    patterns: [/果実酒/],
    reasoning:
      '果実酒/果実酒類/甘味果実酒 (fruit wine) adalah hasil fermentasi buah/anggur dan termasuk khamr, haram.',
    sources: ["QS Al-Maa'idah 5:90", LPPOM],
  },
  {
    id: 'amazake',
    label: 'Amazake / 甘酒',
    status: 'syubhat',
    confidence: 'medium',
    category: 'alcohol',
    // Placed BEFORE the `beer` haram rule: low-alcohol amazake is debated, so it
    // resolves syubhat rather than haram.
    patterns: [/甘酒/],
    reasoning:
      '甘酒 (amazake) beralkohol rendah; sebagian produk hampir bebas alkohol, sebagian berfermentasi. Statusnya diperdebatkan, syubhat. (Berasnya sendiri halal.)',
    sources: ["QS Al-Maa'idah 5:90 (khamr)", LPPOM, JAKIM],
  },
  {
    id: 'beer',
    label: 'Beer / ビール',
    status: 'haram',
    confidence: 'high',
    category: 'alcohol',
    // Broad alcohol vocabulary: all below are fermented/distilled alcoholic
    // drinks (khamr). Placed early so it precedes generic plant/seasoning rules.
    patterns: [
      /ビール/,
      /発泡酒/,
      /リキュール/,
      // NB: negative lookahead — カクテルソース/カクテルドレッシング are
      // condiments (not khamr); only a bare cocktail (the drink) is haram.
      /カクテル(?!ソース|ドレッシング)/,
      /ハイボール/,
      /チューハイ/,
      /ウォッカ/,
      /ブランデー/,
      /ウイスキー/,
      /蒸留酒/,
      /醸造酒/,
      /梅酒/,
      /にごり酒/,
      /どぶろく/,
      /啤酒/,
    ],
    reasoning:
      'ビール/発泡酒/リキュール/カクテル/ハイボール/チューハイ/ウォッカ/ブランデー/ウイスキー/蒸留酒/醸造酒/梅酒/にごり酒/どぶろく/啤酒 (bir Tionghoa) adalah minuman beralkohol (khamr), haram.',
    sources: ["QS Al-Maa'idah 5:90", LPPOM],
  },
  {
    id: 'rice-wine',
    label: 'Rice wine / 米酒',
    status: 'haram',
    confidence: 'high',
    category: 'alcohol',
    // Must precede the generic rice rule (which stays anchored to ^米$ anyway).
    patterns: [/米酒/],
    reasoning: '米酒 (rice wine) adalah minuman beralkohol hasil fermentasi beras, haram.',
    sources: ["QS Al-Maa'idah 5:90", LPPOM],
  },
  {
    id: 'baijiu',
    label: 'Baijiu / 白酒',
    status: 'haram',
    confidence: 'high',
    category: 'alcohol',
    patterns: [/白酒/],
    reasoning:
      '白酒 (baijiu, atau shiroki sake manis Jepang) adalah minuman beralkohol hasil fermentasi/sulingan, haram. Tidak menabrak makanan non-alkohol (audit: satu-satunya kemunculan korpus berkonteks bumbu Tionghoa; tak ada entri curated/katalog non-alkohol yang memuat 白酒).',
    sources: ["QS Al-Maa'idah 5:90", LPPOM],
  },
  {
    id: 'alcohol-seasoning',
    label: 'Alcohol seasoning / 浸漬酒・料酒・酒精',
    status: 'syubhat',
    confidence: 'medium',
    category: 'alcohol',
    // EARLY, before every plant / ph-adjuster / seasoning rule: these tokens are
    // all alcohol-bearing but are shadowed by an innocuous substring otherwise —
    // もも浸漬酒/レモン浸漬酒 by もも/レモン (fruit), ラムレーズン by レーズン
    // (raisin), PH調整剤酒精/酒精PH調整剤 by ph-adjuster, 植物油脂粉末調味料酒/
    // 調味料酒 by 植物油脂/調味料. 浸漬酒 = fruit steeped in alcohol, 料酒 =
    // cooking wine, 酒精 = ethanol, ラムレーズン = rum raisin. /洋酒/ already
    // exists as its own (haram) rule — deliberately not duplicated here.
    // ラムレーズン is added because it matches none of the other patterns and is
    // currently swallowed by the raisin rule.
    patterns: [/浸漬酒/, /料酒/, /酒精/, /ラムレーズン/],
    reasoning:
      '浸漬酒/料酒/酒精/ラムレーズン menandakan alkohol (khamr) dipakai sebagai bahan; residunya bisa tertinggal. Tanpa sertifikasi halal, syubhat.',
    sources: ["QS Al-Maa'idah 5:90", LPPOM],
  },
  {
    id: 'pork',
    label: 'Pork / 豚肉',
    status: 'haram',
    confidence: 'high',
    category: 'animal',
    patterns: [
      /豚肉/, /ぶたにく/, /ポーク/,
      // /ポ一ク/ is the long-vowel OCR misread (ー -> 一, same family as
      // パ一ム油/マ一ガリン); without it ポ一ク調味料 fell through to the halal
      // seasoning rule. ポ一ク cannot be anything but pork.
      /ポ一ク/,
      /ラード/, /豚脂/, /豚エキス/, /豚肉エキス/, /豚骨/, /豚ガラ/,
      /豚ばら/, /豚バラ/, /豚ロース/, /豚ヒレ/, /豚生姜/,
      // Meat cuts. NB: explicit forms only — a bare /豚/ would also catch 海豚
      // (dolphin) and 河豚 (pufferfish), which are seafood, not pork.
      // (verifier round 5: 豚もも肉/豚ひき肉/豚レバー fell through to halal rules)
      /豚もも/, /豚ひき/, /豚挽/, /豚ミンチ/, /豚レバー/, /豚タン/, /豚舌/, /豚肩/, /豚すね/,
      /豚スペアリブ/, /豚足/, /豚ハツ/, /豚ホルモン/, /豚もつ/, /豚軟骨/, /豚テール/, /豚首/, /豚頬/,
      // Verifier round 6: these common pork names produced no finding at all and
      // the banner went green beside halal items.
      /豚トロ/, /豚ミノ/, /豚ガツ/, /豚角煮/, /豚の角煮/, /焼き豚/, /焼豚/, /豚汁/,
      /とんかつ(?!ソース)/, /豚カツ(?!ソース)/, /トンカツ/, /猪肉/, /スパム/,
      // Verifier round 7: ANY token containing 豚 is pork — without this, dishes
      // were shadowed by halal sub-words (豚の生姜焼き -> rule:ginger halal,
      // 豚のりんご煮 -> rule:seaweed). 海豚 (dolphin) and 河豚 (pufferfish) are
      // seafood, not pork.
      /(?<![海河])豚/,
    ],
    reasoning: 'Berasal dari babi (daging/lemak/ekstrak). Haram secara eksplisit.',
    sources: ['QS Al-Baqarah 2:173', LPPOM],
  },
  // --- safety-critical negatives FIRST (before every plant/veg rule) ---------
  // Graham flour (グラハム) contains ハム, so this halal rule MUST precede the
  // ham rule below or graham would be flagged haram.
  halalRule('graham', 'Graham / グラハム', [/グラハム/], 'grain', 'Tepung graham (gandum utuh), nabati, halal.'),
  {
    id: 'ham',
    label: 'Ham / ハム',
    status: 'haram',
    confidence: 'high',
    category: 'animal',
    // Negative lookahead avoids non-pork words that merely contain the kana
    // ハム: ハムスター (hamster), ハムレット (Hamlet), ハムザ, ハムラビ,
    // ハムナプトラ, ハムサ, ハムストリング. ハムスライス/ハムステーキ/ハムカツ
    // etc. still contain bare ハム followed by a non-excluded stem and ARE ham.
    // The サ stem is narrowed with a lookahead so real foods like ハムサンド /
    // ハムサラダ stay haram.
    // アブラハム (Abraham) ends in ハム with nothing after it, so the lookahead
    // cannot catch it; the negative lookbehind excludes the ブラハム tail. The
    // graham rule above already handles グラハム (graham).
    patterns: [/(?<!ブラ)ハム(?!スター|レット|ザ|ラビ|ナプトラ|サ(?!ンド|ラダ)|ストリング)/],
    reasoning: 'Ham hampir selalu dari daging babi. Haram.',
    sources: ['QS Al-Baqarah 2:173', LPPOM],
  },
  {
    id: 'charshu',
    label: 'Char siu / チャーシュー',
    status: 'haram',
    confidence: 'high',
    category: 'animal',
    patterns: [/チャーシュー/],
    reasoning: 'チャーシュー (Chinese roast pork) berbahan dasar daging babi. Haram.',
    sources: ['QS Al-Baqarah 2:173', LPPOM],
  },
  {
    id: 'animal-plant-fat',
    label: 'Animal/plant fat / 動植物油脂',
    status: 'syubhat',
    confidence: 'medium',
    category: 'fat',
    // MUST precede veg-oil (/植物油/) — 動植物油脂 contains 植物油 as a substring.
    patterns: [/動植物油脂/, /動植物性油脂/, /動植物油/, /動物油脂/, /動物性油脂/, /動物性脂肪/],
    reasoning: 'Lemak "nabati+hewani" (動植物油脂) memuat lemak hewani tanpa keterangan spesies/sembelihan syar\'i. Syubhat.',
    sources: [LPPOM, JAKIM],
  },
  halalRule('hydrolyzed-yeast', 'Hydrolyzed yeast / 加水分解酵母', [/加水分解酵母/, /酵母加水分解物/], 'additive', 'Ragi terhidrolisis, halal.'),
  // MUST precede the generic hydrolyzed-protein (syubhat) rule below: a token
  // that explicitly says 植物性 (plant) before 加水分解 is a plant protein and is
  // halal; otherwise the generic /加水分解/ rule shadows it with syubhat.
  halalRule('plant-hydrolyzed-protein', 'Plant hydrolyzed protein / 植物性蛋白加水分解物', [/植物性.{0,8}加水分解/], 'plant', 'Protein nabati terhidrolisis (mis. dari kedelai/gandum) — nabati, halal.'),
  {
    id: 'hydrolyzed-protein',
    label: 'Hydrolyzed protein / たん白加水分解物',
    status: 'syubhat',
    confidence: 'medium',
    category: 'additive',
    // Early so 卵/加水分解物 (after VARIANT_FOLD 蛋→卵) and たんぱく質加水分解物
    // are not swallowed by the egg rule / NOISE_RE.
    patterns: [
      /加水分解物/,
      /加水分解/,
      /たん白加水分解/,
      /タンパク加水分解/,
      /水分解物/,
      /自己消化物/,
    ],
    reasoning: 'Protein terhidrolisis umumnya dari kedelai/jagung, tetapi bisa juga dari hewani. Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'dehydroacetic-acid',
    label: 'Sodium dehydroacetate / 脱氢乙酸钠',
    status: 'syubhat',
    confidence: 'low',
    category: 'additive',
    // Early: otherwise /酢酸/, /酢酸na/ shadow it.
    patterns: [/デヒドロ酢酸/, /脱氢乙酸/],
    reasoning: 'Pengawet sintetis netral sumber (tidak hewani) tetapi kimiawi; verifikasi label halal. Keyakinan rendah.',
    sources: ['EFSA — E265/E266', LPPOM],
  },
  {
    id: 'mirin',
    label: 'Mirin / 料理酒',
    status: 'syubhat',
    confidence: 'medium',
    category: 'alcohol',
    patterns: [/本みりん/, /みりん/, /味醂/, /料理酒/, /調理酒/],
    reasoning:
      'Mirin/料理酒 adalah bumbu masak beralkohol (beras). Banyak fatwa mengharamkan; "みりん風調味料" (rendah alkohol) pun tetap perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'sake-lees',
    label: 'Sake lees / 酒粕',
    status: 'syubhat',
    confidence: 'medium',
    category: 'alcohol',
    patterns: [/酒粕/, /酒糟/, /さけかす/, /酒粕パウダー/],
    reasoning:
      '酒粕 (sake lees) adalah hasil samping fermentasi sake dan dapat masih mengandung residu alkohol. Minimal syubhat. Catatan: bisa ter-tag vegan di Open Food Facts (fermentasi beras) tetapi itu hanya soal sumber hewani, bukan bebas alkohol.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'cochineal',
    label: 'Cochineal / コチニール色素',
    status: 'syubhat',
    confidence: 'medium',
    category: 'colorant',
    patterns: [/コチニール/, /カルミン/, /カルミン酸/],
    reasoning:
      'Pewarna dari serangga cochineal (E120). Ulama berbeda pendapat; sebagian menghindari. Umum di kamaboko/produk merah muda Jepang.',
    sources: ['EFSA — E120', LPPOM],
  },
  {
    id: 'animal-extract',
    label: 'Animal extract / 動物性エキス',
    status: 'syubhat',
    confidence: 'medium',
    category: 'animal',
    patterns: [
      /動物性エキス/,
      /動物エキス/,
      /肉エキス/,
      /チキンエキス/,
      /ビーフエキス/,
      /魚介エキス/,
      /煮干しエキス/,
    ],
    reasoning:
      'Ekstrak hewani tanpa keterangan spesies/sembelihan. Sumber tidak dapat dipastikan, sehingga syubhat.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'gelatin',
    label: 'Gelatin / ゼラチン',
    status: 'syubhat',
    confidence: 'medium',
    category: 'animal',
    patterns: [/ゼラチン/, /コラーゲン/],
    reasoning:
      'Gelatin/kolagen bisa dari babi (haram), sapi syar\'i (halal), atau ikan. Tanpa keterangan sumber, syubhat.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'rennet-pepsin',
    label: 'Rennet / pepsin',
    status: 'syubhat',
    confidence: 'medium',
    category: 'enzyme',
    patterns: [/レンネット/, /レンニン/, /ペプシン/, /トランスグルタミナーゼ/],
    reasoning:
      'Enzim dapat berasal dari hewan (termasuk babi) atau mikroba. Sumber menentukan status; tanpa keterangan syubhat.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'cheese-powder',
    label: 'Cheese powder',
    status: 'syubhat',
    confidence: 'medium',
    category: 'dairy',
    // Plain チーズ is a curated entry (natural-cheese); this rule-only token is
    // the powdered form, which may contain animal rennet like any cheese.
    patterns: [/チーズパウダー/, /チーズ粉末/],
    reasoning:
      'Bubuk keju dapat mengandung rennet hewani (lihat rennet) sehingga perlu sertifikasi halal. Syubhat.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'l-cysteine',
    label: 'L-cysteine / cystine / システイン・シスチン',
    status: 'syubhat',
    confidence: 'medium',
    category: 'additive',
    // シスチン (cystine) has the same source risk as L-cysteine and is included
    // as the amino-acid exclusion: the bulk expander must not re-add it as a
    // halal "amino acid" (candidatesFor() skips rule-matched tokens).
    patterns: [/システイン/, /シスチン/],
    reasoning:
      'L-sistein/sistin (シスチン) dapat berasal dari hidrolisis rambut/bulu/plasma hewani atau sintetis/mikroba. Tanpa keterangan sumber syubhat.',
    sources: ['EFSA — E920', LPPOM],
  },
  {
    id: 'white-dashi',
    label: 'Shiro-dashi / 白だし',
    status: 'syubhat',
    confidence: 'medium',
    category: 'seasoning',
    patterns: [/白だし/],
    reasoning:
      '白だし sering mengandung mirin/alkohol dan ekstrak hewani. Perlu verifikasi sertifikasi.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'emulsifier',
    label: 'Emulsifier / 乳化剤',
    status: 'syubhat',
    confidence: 'medium',
    category: 'additive',
    patterns: [/乳化剤/],
    reasoning:
      'Emulsifier bisa nabati (halal), sapi syar\'i (halal), atau babi (haram). Tanpa keterangan sumber syubhat.',
    sources: ['EFSA — E471/E322', LPPOM],
  },
  {
    id: 'shortening',
    label: 'Shortening / ショートニング',
    status: 'syubhat',
    confidence: 'medium',
    category: 'fat',
    patterns: [/ショートニング/],
    reasoning:
      'Shortening adalah lemak terhidrogenasi, bisa berbasis hewani (termasuk babi) atau nabati.',
    sources: [LPPOM, JAKIM],
  },
  // Named plant/fermentation colourants are unambiguously halal. Placed BEFORE
  // the generic flavoring/coloring rules: the generic 着色料/色素/香料 stay
  // syubhat because an UNNAMED colourant can be animal/synthetic/insect-derived
  // (e.g. コチニール色素), while a NAME tells us the source (caramel from sugar,
  // paprika/vegetable/gardenia/annatto/beet/red-koji/carotenoid → plant or
  // fermentation).
  halalRule(
    'named-colorant',
    'Named colourant / 色素（名称あり）',
    [
      /カラメル色素/,
      /パプリカ色素/,
      /野菜色素/,
      /クチナシ色素/,
      /アナトー色素/,
      /ビート色素/,
      /紅麹色素/,
      /ベニコウジ色素/,
      /カロテノイド色素/,
      /カロチノイド色素/,
      /カロチン色素/,
      /カロテン色素/,
      /ウコン/,
      // OCR-tolerant turmeric (ウコン misread with a stray glyph in the middle).
      /ウコ.?ン/,
      /パプリカ/,
      /クランベリー/,
      /ニンジン/,
      /カロテノイド/,
      /アナトー/,
      /ビート/,
      /紅麹/,
      /紅花/,
      // 野菜 only in colourant context: a bare /野菜/ would grant halal to
      // 野菜エキス (currently syubhat via generic-extract), a status change this
      // rule was not audited for. 着色料（野菜） still resolves via these forms.
      /着色料野菜/,
      /色素野菜/,
    ],
    'colorant',
    'Pewarna dengan nama sumber nabati/fermentasi (karamel, paprika, sayur, gardenia, annatto, bit, koji merah, karotenoid) — halal.'
  ),
  {
    id: 'flavoring',
    label: 'Flavoring / 香料',
    status: 'syubhat',
    confidence: 'low',
    category: 'additive',
    patterns: [/香料/, /看料/, /香精/, /食用香精/, /食品用香精/],
    reasoning:
      'Perisa dapat mengandung pelarut alkohol atau turunan hewani. Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },
  halalRule('sugar-alcohol', 'Sugar alcohol / 糖アルコール', [/糖アルコール/], 'sweetener', 'Gula alkohol (mis. sorbitol/マルチトール), umumnya halal; no alkohol khamr.'),
  {
    id: 'alcohol',
    label: 'Alcohol / アルコール',
    status: 'syubhat',
    confidence: 'medium',
    category: 'alcohol',
    patterns: [/アルコール/, /エタノール/, /乙醇/],
    reasoning:
      'Alkohol/etanol sebagai pelarut atau aditif diperdebatkan antar ulama; label halal diperlukan.',
    sources: [LPPOM, JAKIM],
  },
  // --- common meats (halal if slaughtered per shariah; caveat noted) ---------
  {
    id: 'chicken',
    label: 'Chicken / チキン',
    status: 'syubhat',
    confidence: 'medium',
    category: 'animal',
    // 蒸し鶏 (steamed chicken) and 鶏脂 (chicken fat) are unlabeled poultry.
    // 食肉 ("meat") is added here (chicken = first meat rule) because a generic
    // meat term cannot be certified halal; it is left syubhat, never halal.
    patterns: [/チキン/, /鶏肉/, /とりにく/, /鶏ささみ/, /若鶏/, /鶏がら/, /鶏ガラ/, /蒸し鶏/, /鶏脂/, /食肉/,
      // Meat cuts (verifier round 5: 鶏もも肉 fell through to the peach rule).
      /鶏もも/, /鶏ひき/, /鶏挽/, /鶏レバー/, /鶏手羽/, /鶏むね/, /鶏胸/, /鶏皮/, /鶏軟骨/, /鶏もつ/, /鶏ハツ/, /鶏テール/,
      // Verifier round 6: more poultry names that produced no finding.
      /地鶏(?!卵)/, /鴨肉/, /鴨鍋/, /合鴨/, /カモ(?!ミール)/, /焼き鳥/, /焼鳥/, /やきとり/, /砂肝/, /ぼんじり/,
      // Verifier round 7: any chicken token, but never 鶏卵 (egg, halal).
      /鶏(?!卵)/],
    reasoning: 'Daging ayam halal bila disembelih syar\'i, tetapi di Jepang umumnya tidak. Tanpa logo/sertifikasi halal, syubhat.',
    sources: ['QS Al-Baqarah 2:173 (prinsip)', JAKIM],
  },
  {
    id: 'beef',
    label: 'Beef / 牛肉',
    status: 'syubhat',
    confidence: 'medium',
    category: 'animal',
    patterns: [/ビーフ/, /牛肉/, /牛脂/, /ヘット/, /牛舌/, /牛タン/,
      // Meat cuts. NB: never bare /牛/ — it matches 牛乳 (milk) and 牛蒡 (burdock).
      /牛もも/, /牛ひき/, /牛挽/, /牛レバー/, /牛バラ/, /牛肩/, /牛ロース/, /牛ヒレ/, /牛すね/, /牛テール/, /牛軟骨/, /牛もつ/, /牛ハツ/,
      // Verifier round 7: 牛丼/牛スジ/牛ステーキ etc. still fell through.
      /牛(?!乳|蒡|脂)/],
    reasoning: 'Daging/lemak sapi halal bila disembelih syar\'i, tetapi di Jepang umumnya tidak. Tanpa sertifikasi halal, syubhat.',
    sources: ['QS Al-Baqarah 2:173 (prinsip)', JAKIM],
  },
  {
    id: 'lamb',
    label: 'Lamb / 羊肉',
    status: 'syubhat',
    confidence: 'medium',
    category: 'animal',
    // NB: never bare /ラム/ — it matches グラム (gram). Require a meat context.
    patterns: [/ラム肉/, /ラムチョップ/, /羊肉/, /マトン/, /羊もも/, /ラムもも/, /羊肩/, /ラム肩/,
      // Verifier round 7: bare 羊 except 羊羹 (a sweet, not meat).
      /羊(?!羹)/],
    reasoning: 'Daging kambing/domba halal bila disembelih syar\'i, tetapi di Jepang umumnya tidak. Tanpa sertifikasi halal, syubhat.',
    sources: ['QS Al-Baqarah 2:173 (prinsip)', JAKIM],
  },
  {
    // Generic meat-cut safety net. An unidentified cut (もも肉, ひき肉, レバー)
    // cannot be certified halal and must never fall through to a plant rule:
    // verifier round 5 caught 豚もも肉 -> halal:rule:peach and 豚肩ロース ->
    // halal:exp:スクロース. Species rules run first, so 豚肉/牛肉/鶏肉 keep their
    // own verdicts; this rule only catches the rest.
    id: 'meat-cut',
    label: 'Meat cut / 肉の部位',
    status: 'syubhat',
    confidence: 'medium',
    category: 'animal',
    patterns: [
      /ひき肉/, /挽肉/, /びき肉/, /挽き肉/, /合い?びき肉/, /合い?挽き肉/, /メンチ/, /(?<!魚)(?<!フィッシュ)ミンチ(?!カツ)/,
      /レバー/, /レバ刺し/, /スペアリブ/, /バラ肉/, /もも肉/, /肩ロース/,
      // Verifier round 7: katakana cut forms and dish names produced no finding.
      /モモ肉/, /スネ肉/, /ムネ肉/, /モツ/, /モツ鍋/, /焼肉/, /肉まん/, /肉団子/, /餃子/, /焼売/,
      // カツオ (bonito, FISH) must never be a cut. /扱/ is belt-and-braces: the
      // OCR garble カツ扱 is folded to カツオ in normalize.ts, but if that fold
      // ever misses, the raw カツ扱 form must still not resolve as a meat cut.
      /ジビエ/, /カツ(?!オ|扱)/,
      // ロース needs a meat/cut context AND must not match ローステッド (roasted):
      // a bare pattern also catches the -ose sugars トレハロース and スクロース
      // (verifier rounds 5-6). リブ covers リブロース (round 7).
      /(^|肩|ヒレ|もも|バラ|肉|豚|鶏|牛|羊|ラム|リブ)ロース(?!ト|テ|タ)/,
      // ヒレ: shark fin (フカヒレ) and fish fins are seafood, not meat.
      /(?<!フカ)(?<!サメ)(?<!オ)ヒレ/, /ヒレカツ/,
      /手羽/, /ささみ/, /もつ/, /ホルモン/, /ハラミ(?!ツ)/, /ミノ(?!酸)/, /ガツ(?!オ)/, /ハチノス/, /センマイ/, /ギアラ/,
      /(?<!まぐろ)(?<!マグロ)角煮/, /背脂/, /アキレス腱/, /すね肉/, /肩肉/, /胸肉/, /シンタマ/, /ウデ肉/,
      /フランクフルト/, /(?<!フィッシュ)(?<!魚)(?<!コーン)ウインナー(?!コーヒー)/, /(?<!フィッシュ)(?<!魚)(?<!コーン)ナゲット/, /サラミ/,
    ],
    reasoning:
      'Potongan daging (sapi/ayam/kambing) tidak bisa dipastikan halal tanpa sertifikasi penyembelihan; syubhat.',
    sources: ['QS Al-Baqarah 2:173 (prinsip)', JAKIM],
  },
  {
    id: 'fish',
    label: 'Fish / 魚',
    status: 'halal',
    confidence: 'medium',
    category: 'animal',
    patterns: [/魚/, /さかな/, /フィッシュ/, /白身魚/],
    reasoning: 'Ikan dan hasil laut pada dasarnya halal menurut mayoritas ulama.',
    sources: ["QS Al-Maa'idah 5:96", 'LPPOM MUI — hasil laut'],
  },
  {
    id: 'egg',
    label: 'Egg / 卵',
    status: 'halal',
    confidence: 'medium',
    category: 'animal',
    patterns: [/卵/, /たまご/, /タマゴ/, /玉子/, /鶏卵/, /鸡蛋/, /蛋黃/, /蛋黄/, /雞蛋/, /雞卵/],
    reasoning: 'Telur halal.',
    sources: ['LPPOM MUI — turunan hewani halal', JAKIM],
  },
  {
    id: 'milk',
    label: 'Milk / 牛乳',
    status: 'halal',
    confidence: 'medium',
    category: 'dairy',
    patterns: [/牛乳/, /ミルク/, /乳成分/, /乳成/, /生乳/],
    reasoning: 'Susu halal; waspadai enzim/rennet pada produk olahannya (lihat keju/rennet).',
    sources: ['LPPOM MUI — turunan susu', JAKIM],
  },

  // --- common plant / mineral ingredients (clearly halal) --------------------
  halalRule('garlic', 'Garlic / にんにく', [/にんにく/, /んにく/, /ニンニク/, /大蒜/], 'plant', 'Bawang putih (nabati), halal.'),
  halalRule('onion', 'Onion / 玉ねぎ', [/玉ねぎ/, /玉葱/, /たまねぎ/, /オニオン/], 'plant', 'Bawang bombai (nabati), halal.'),
  halalRule('ginger', 'Ginger / しょうが', [/しょうが/, /生姜/, /ショウガ/], 'plant', 'Jahe (nabati), halal.'),
  halalRule('carrot', 'Carrot / にんじん', [/にんじん/, /人参/, /ニンジン/], 'plant', 'Wortel (nabati), halal.'),
  halalRule('potato', 'Potato / じゃがいも', [/じゃがいも/, /ジャガイモ/, /馬鈴薯/], 'plant', 'Kentang (nabati), halal.'),
  halalRule('cabbage', 'Cabbage / キャベツ', [/キャベツ/], 'plant', 'Kubis (nabati), halal.'),
  halalRule('tomato', 'Tomato / トマト', [/トマト/], 'plant', 'Tomat (nabati), halal.'),
  halalRule('cucumber', 'Cucumber / きゅうり', [/きゅうり/, /胡瓜/, /キュウリ/], 'plant', 'Mentimun (nabati), halal.'),
  halalRule('lemon', 'Lemon / レモン', [/レモン/, /レモグラス/, /レモングラス/], 'plant', 'Lemon / sereh (nabati), halal.'),
  halalRule('wheat', 'Wheat / 小麦', [/小麦/, /こむぎ/], 'plant', 'Gandum (nabati), halal.'),
  halalRule('soybean', 'Soybean / 大豆', [/大豆/, /だいず/], 'plant', 'Kedelai (nabati), halal.'),
  halalRule('rice', 'Rice / 米', [/^米$/, /白米/, /玄米/, /米粉/, /お米/, /こめ/, /ライス/], 'plant', 'Beras (nabati), halal.'),
  halalRule('corn', 'Corn / とうもろこし', [/とうもろこし/, /コーン/, /玉蜀黍/], 'plant', 'Jagung (nabati), halal.'),
  halalRule('sesame', 'Sesame / ごま', [/ごま/, /胡麻/, /ゴマ/], 'plant', 'Wijen (nabati), halal.'),
  halalRule('mustard', 'Mustard / マスタード', [/マスタード/], 'plant', 'Moster (nabati), halal.'),
  halalRule('spices', 'Spices / 香辛料', [/香辛料/, /スパイス/, /胡椒/, /こしょう/, /コショウ/], 'plant', 'Rempah-rempah (nabati), halal.'),
  halalRule('acidulant', 'Acidulant / 酸味料', [/酸味料/], 'additive', 'Asam pengatur rasa, umumnya halal.'),
  // MUST precede the generic /デンプン|でん粉|澱粉/ halal rule below: 加工/化工/
  // 酸化 forms are MODIFIED starch and are syubhat. A curated EXACT hit wins
  // first (modified-starch entry), so this rule is the fallback for (a) merged
  // OCR tokens (加工でん粉キサンタンセルロース, ダーノ加工澱粉) and (b) the
  // observed OCR variants that miss the curated names (加エ/カ工, テ for デ,
  // dropped デ: 加工プン/加工アンプン/加工デンナン, エでん粉).
  {
    id: 'modified-starch',
    label: 'Modified starch / 加工デンプン',
    status: 'syubhat',
    confidence: 'medium',
    category: 'additive',
    patterns: [
      /加工デンプ/, /加工テンプ/, /加工でん粉/, /加工でんぷん/, /加工澱粉/,
      /化工デンプ/, /化工澱粉/, /化工でん粉/,
      /酸化デンプ/, /酸化澱粉/, /酸化でん粉/, /酸化でんぷん/,
      // Minimal tokens that can only be a mangled 加工デンプン (previously stored
      // as halal curated entries by the expander — a false-halal source).
      /加工プン/, /加工アンプン/, /加工デンナン/,
      /加エデンプン/, /加エデンブン/, /カ工でん粉/, /エでん粉/,
    ],
    reasoning:
      'Pati termodifikasi (加工/化工/酸化デンプン): modifikasi dapat memakai reagen/asam lemak hewani. Syubhat.',
    sources: ['LPPOM MUI — bahan tambahan', JAKIM],
  },
  halalRule('thickener', 'Thickener / 増粘多糖類', [/増粘多糖類/, /増粘剤/, /糊料/], 'additive', 'Penstabil/pengental polisakarida, umumnya nabati/mikroba, halal.'),
  halalRule('veg-oil', 'Vegetable oil / 植物油脂', [/植物油脂/, /植物油/, /サラダ油/], 'fat', 'Minyak nabati, halal.'),
  halalRule('starch', 'Starch / でん粉', [/でん粉/, /でんぷん/, /澱粉/, /デンプン/], 'plant', 'Pati nabati, halal.'),
  halalRule('mayonnaise', 'Mayonnaise / マヨネーズ', [/マヨネーズ/], 'condiment', 'Mayones umumnya dari telur+cuka, halal (waspadai aditif).', 'medium'),
  halalRule('bread', 'Bread / パン', [/パン/], 'grain', 'Roti umumnya halal, tetapi bisa mengandung shortening/margarin hewani — cek bila ada.', 'low'),
  // MUST precede the 風味調味料 (fermented-seasoning) rule below: 明太子風味調味料
  // is cod-roe (seafood, halal), not a generic fermented/flavoured seasoning
  // syubhat. Bare 明太子 also has a curated entry, which still wins.
  halalRule('mentaiko', 'Mentaiko / 明太子', [/明太子/], 'animal', '明太子 (telur ikan kod/mentaiko) — hasil laut, halal menurut mayoritas ulama.'),
  // MUST precede the generic 'seasoning' (halal-low) rule below: fermented /
  // brewed seasonings carry alcohol from fermentation, and flavour/liquid
  // seasonings commonly carry alcohol or animal extracts. Plain 調味料 /
  // 和風調味料 / 粉末調味料 / 添付調味料 stay halal-low.
  {
    id: 'fermented-seasoning',
    label: 'Fermented/flavoured seasoning',
    status: 'syubhat',
    confidence: 'medium',
    category: 'seasoning',
    patterns: [
      /醸造調味料/,
      /発酵調味料/,
      /醗酵調味料/,
      /はっ酵調味料/,
      /米発酵/,
      /発酵風味料/,
      /発風味料/,
      /香味調味料/,
      /風味調味料/,
      /液体調味料/,
    ],
    reasoning:
      'Bumbu fermentasi/beraroma (醸造/発酵/香味/風味/液体調味料) dapat mengandung alkohol hasil fermentasi atau ekstrak hewani. Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },
  halalRule('seasoning', 'Seasoning / 調味料', [/調味料/, /调味料/, /調味油/], 'additive', 'Bumbu/penyedap (mis. アミノ酸等). Umumnya halal, tetapi sebagian bisa berisi ekstrak hewani.', 'low'),
  halalRule('fruit-juice', 'Fruit juice / 果汁', [/果汁/, /果计/], 'plant', 'Sari buah (nabati), halal.'),

  // --- frozen / atatame (ready-meal) common items ----------------------------
  halalRule('organic-acid', 'Organic acid / 有機酸', [/有機酸/], 'additive', 'Asam organik (pengatur keasaman), halal.'),
  // /食物繊/ catches the OCR-truncated prefix of 食物繊維 (seen as 食物繊 on a
  // real label); it cannot match anything else.
  halalRule('dietary-fiber', 'Dietary fiber / 食物繊維', [/食物繊維/, /食物線維/, /食物繊/], 'plant', 'Serat pangan, halal.'),
  halalRule('pepper2', 'Pepper / 胡椒', [/胡椒/, /胡線/, /胡織/, /黒胡/, /白胡/, /ブラックペッパー/, /ホワイトペッパー/], 'plant', 'Merica (nabati), halal.'),
  halalRule('spice2', 'Spice / 香辛', [/香辛/, /香平料/], 'plant', 'Rempah-rempah (nabati), halal.'),
  halalRule('breadcrumbs', 'Breadcrumbs / パン粉', [/パン粉/], 'grain', 'Tepung roti, halal.'),
  halalRule('phosphate', 'Phosphate / リン酸', [/リン酸/, /三聚磷酸/, /六偏磷酸/], 'additive', 'Garam fosfat (mineral), halal.'),
  // Anchored on purpose: bare /リン/ is a substring of リンゴ (apple),
  // グリセリン, リン酸, プリン etc. Only the exact mineral token リン is halal.
  halalRule('phosphorus', 'Phosphorus / リン', [/^リン$/], 'mineral', 'Fosfor (mineral), halal.'),
  halalRule('palm-oil', 'Palm oil / パーム油', [/パーム油/, /パーム/, /パ一ム油/, /パ一ム/, /パ.ーム油/, /棕榈油/, /棕桐油/], 'fat', 'Minyak sawit (nabati), halal.'),
  halalRule('caramel', 'Caramel / カラメル', [/カラメル/, /ラメル/], 'colorant', 'Karamel dari gula, halal.'),
  halalRule('chili', 'Chili / 唐辛子', [/唐辛子/, /とうがらし/, /トウガラシ/], 'plant', 'Cabai (nabati), halal.'),
  halalRule('ketchup', 'Ketchup / ケチャップ', [/ケチャップ/], 'condiment', 'Saus tomat, halal.'),
  halalRule('pickles', 'Pickles / ピクルス', [/ピクルス/], 'plant', 'Acar sayur, halal.'),
  // OCR-split fragments of デキストリン / 難消化性デキストリン ("デキス トリン",
  // "難消化性 ストリン"). The fragments are ANCHORED on purpose: an unanchored
  // /トリン/ also matched OCR soup like "脱 脂粉乳デストリンク リー" and granted
  // it halal. Before this, the bare fragment トリン fuzzy-matched ミリン (mirin)
  // and reported a false syubhat on a halal starch-derived additive.
  halalRule('dextrin', 'Dextrin / デキストリン', [/デキストリン/, /^トリン$/, /^ストリン$/, /^難消化性$/], 'additive', 'Dekstrin dari pati, halal.'),
  halalRule('liquid-sugar', 'Liquid sugar / 液糖', [/液糖/, /果糖/, /ぶどう糖液糖/, /糖漿/, /糖浆/, /果葡糖/], 'sweetener', 'Gula cair / glukosa-fruktosa (HFCS), halal.'),
  halalRule('sugar-variant', 'Sugar / 砂糖', [/沙糖/], 'sweetener', 'Gula (nabati), halal. Varian OCR 沙糖.'),
  halalRule('miso', 'Miso / 味噌', [/味噌/, /みそ/], 'fermented', 'Miso fermentasi kedelai; umumnya halal, waspadai residu alkohol.', 'low'),
  halalRule('natto', 'Natto / 納豆', [/納豆/], 'fermented', 'Natto (kedelai fermentasi Bacillus subtilis) — nabati, halal.'),
  // Must precede the /バター/ (butter) rule: バター入りマーガリン / マーガリン
  // contains バター as a substring but is margarine (mixed/possibly animal fat),
  // so butter-first would wrongly label it halal.
  {
    id: 'margarine',
    label: 'Margarine / マーガリン',
    status: 'syubhat',
    confidence: 'medium',
    category: 'fat',
    // /マ一ガリン/ is the observed OCR misread of the long vowel (ー -> 一,
    // fldb_4902410315353); without it the token fell through to the catalog as
    // unknown(margarine) instead of inheriting the syubhat verdict.
    // /マ一ガリ/ (truncated tail ン) is added for the expanded dev golden set
    // (off2_0248400601186): マ一ガリ is two edits from マーガリン, past the
    // length-aware fuzzy gate, so the rule layer must catch it.
    patterns: [/マーガリン/, /マ一ガリン/, /マ一ガリ/],
    reasoning: 'Margarin bisa berbasis lemak hewani (termasuk babi) atau nabati. Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },
  halalRule('butter', 'Butter / バター', [/バター/], 'dairy', 'Mentega dari susu, halal.', 'medium'),
  // クリームチーズ is a CHEESE (same animal-rennet doubt as the curated チーズ
  // entry). It MUST precede the generic /クリーム/ halal rule below, otherwise
  // クリームチーズ/クリームチーズオースト was granted halal (off2_4903308030358).
  {
    id: 'cream-cheese',
    label: 'Cream cheese / クリームチーズ',
    status: 'syubhat',
    confidence: 'medium',
    category: 'dairy',
    patterns: [/クリームチーズ/],
    reasoning:
      'Keju krim dapat memakai rennet hewani (lihat keju/rennet) — perlu sertifikasi halal, syubhat.',
    sources: [LPPOM, JAKIM],
  },
  halalRule('cream', 'Cream / クリーム', [/生クリーム/, /クリーム/], 'dairy', 'Krim susu, halal.', 'medium'),
  halalRule('milk-powder', 'Milk powder / 粉乳', [/脱脂粉乳/, /全粉乳/, /全脂乳粉/, /粉乳/], 'dairy', 'Susu bubuk, halal.', 'medium'),
  halalRule('whey', 'Whey / ホエイ', [/ホエイ/, /乳清/], 'dairy', 'Whey dari susu; umumnya halal, waspadai rennet.', 'low'),
  halalRule('carrageenan', 'Carrageenan / カラギーナン', [/カラギーナン/], 'additive', 'Karagenan rumput laut, halal.'),
  halalRule('ph-adjuster', 'pH adjuster', [/ph調/], 'additive', 'Pengatur pH, umumnya halal.'),
  halalRule('antioxidant', 'Antioxidant / 酸化防止剤', [/酸化防止剤/, /酸化防/, /抗氧化/], 'additive', 'Antioksidan, umumnya halal.'),
  // タ -> 三 garble (observed "多類ビ三C"); rules run on lowercased text, so the
  // variant patterns use a lowercase c.
  // The Latin abbreviations VC/VE are anchored to the WHOLE normalized token:
  // bare /vc/ and /ve/ matched ANY token containing them (VEAL -> halal:vitamin,
  // VERMOUTH -> halal) — a false-halal on meat and alcohol. normalize() strips
  // dots/spaces, so V.C / V C already arrive as "vc". ^v[ce](\d{1,2})?$ covers
  // VC, VE, VC12, VE6-ish forms only.
  halalRule('vitamin', 'Vitamin', [/ビタミン/, /ビタ三ン/, /ピタ三ン/, /ピタミン/, /ミンe/, /^v[ce](\d{1,2})?$/, /ビ三c/, /ビタ三ンc/, /ビ三ンc/, /维生素c/, /维生素/], 'additive', 'Vitamin, halal.'),
  halalRule('shallot', 'Shallot / シャロット', [/シャロット/, /エシャロット/, /シヤロット/], 'plant', 'Bawang merah (nabati), halal.'),
  halalRule('star-anise', 'Star anise / スターアニス', [/スターアニス/, /スターニス/, /スター二ス/, /八角/], 'plant', 'Adas bintang (nabati), halal.'),
  halalRule('chili-powder', 'Chili powder / チリパウダー', [/チリパウダ/, /チリパウ/, /チリペッパー/], 'plant', 'Bubuk cabai (nabati), halal.'),
  halalRule('rapeseed-oil', 'Rapeseed oil / なたね油', [/なたね油/, /菜種油/, /キャノーラ油/], 'fat', 'Minyak kanola/rapeseed (nabati), halal.'),
  halalRule('curry-powder', 'Curry powder / カレー粉', [/カレー粉/, /カレーパウダー/], 'plant', 'Bumbu kari (rempah, nabati), halal.'),
  halalRule('chutney', 'Chutney / チャツネ', [/チャツネ/], 'condiment', 'Chatni (buah/sayur), halal.'),
  halalRule('silica', 'Silica / 二酸化ケイ素', [/二酸化ケイ素/, /酸化ケイ素/, /二酸化珪素/, /二酸化イ素/, /微粒二酸化/], 'additive', 'Silika (mineral), halal.'),
  halalRule('calcium', 'Calcium salt / 酸Ca', [/酸ca/, /炭酸/], 'additive', 'Garam kalsium (mineral), halal.'),
  halalRule('citric', 'Citric acid / クエン酸', [/クエン酸/, /クエン/, /柠檬酸/, /エン酸/], 'additive', 'Asam sitrat, halal.'),
  halalRule('lactic-acid', 'Lactic acid / 乳酸', [/乳酸/], 'additive', 'Asam laktat (fermentasi), halal.'),
  halalRule('malic', 'Malic acid / リンゴ酸', [/リンゴ酸/, /りんご酸/], 'additive', 'Asam malat, halal.'),
  // OCR truncations of アミノ酸 (leading ア lost: ミノ酸等; ミ misread as 三:
  // 三ノ酸等/三酸等) are common on real labels. These fragments occur only in
  // the amino-acid seasoning family (MSG etc.), which is halal — same class as
  // the existing /ア三/ pattern.
  halalRule('amino-acid', 'Amino acid / アミノ酸', [/アミノ酸/, /ア三ノ酸/, /ア三/, /ミノ酸/, /三ノ酸/, /三酸/, /グルタミン酸/, /味精/], 'additive', 'Asam amino penyedap, halal. 味精 = MSG. グルタミン酸 = glutamate.'),
  halalRule('succinate', 'Succinate / コハク酸', [/コハク酸/, /八ク酸/], 'additive', 'Garam asam suksinat, halal.'),
  halalRule('nucleic', 'Nucleic acid / 核酸', [/核酸/], 'additive', 'Asam nukleat penyedap, halal.'),
  {
    id: 'animal-protein',
    label: 'Animal protein / 動物性蛋白',
    status: 'syubhat',
    confidence: 'medium',
    category: 'additive',
    // MUST precede 'plant-protein' below: 動植物蛋白 contains 植物蛋白, so a
    // plant-protein rule evaluated first would mislabel mixed animal/plant
    // protein as halal.
    patterns: [/動物蛋白/, /動物性蛋白/, /動植物蛋白/],
    reasoning:
      'Protein hewani (mis. 動物性蛋白/動植物蛋白) tanpa keterangan spesies atau sembelihan syar\'i. Syubhat.',
    sources: [LPPOM, JAKIM],
  },
  halalRule('plant-protein', 'Plant protein / 植物性たん白', [/植物性たん白/, /大豆たん白/, /植物蛋白/, /植物性蛋白/], 'plant', 'Protein nabati, halal.'),
  halalRule('thickener2', 'Thickener / 増粘', [/増粘/, /増幹/, /增粘/, /多糖/, /多糖类/], 'additive', 'Pengental polisakarida, umumnya nabati/mikroba, halal.'),
  {
    id: 'soy-sauce-variant',
    label: 'Soy sauce / 醤油',
    status: 'syubhat',
    confidence: 'medium',
    category: 'fermented',
    patterns: [/醤油/, /酱油/, /しょうゆ/],
    reasoning: 'Kecap Jepang dapat mengandung alkohol dari fermentasi. Perlu verifikasi (menangkap varian seperti 添付醤油).',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'coloring',
    label: 'Colouring / 着色料',
    status: 'syubhat',
    confidence: 'low',
    category: 'colorant',
    // /^色素$/ is anchored: bare 色素 is a generic colorant (source-dependent),
    // while prefixes like パプリカ色素/野菜色素 have their own halal rules and
    // コチニール色素 its own syubhat entry. An unanchored /色素/ would shadow them.
    patterns: [/着色料/, /色料/, /^色素$/],
    reasoning: 'Pewarna generik bisa nabati, sintetis, atau serangga/hewani (mis. cochineal). Perlu verifikasi.',
    sources: ['EFSA — pewarna', LPPOM],
  },
  {
    id: 'bleaching-agent',
    label: 'Bleaching agent / 漂白剤',
    status: 'syubhat',
    confidence: 'low',
    category: 'additive',
    patterns: [/漂白剤/],
    reasoning:
      'Zat pemutih (漂白剤) bisa berupa peroksida/sulfit (mineral) atau turunan lemak/enzim hewani tergantung produk. Perlu verifikasi.',
    sources: ['EFSA — E928/E925', LPPOM],
  },
  // MUST precede the generic /ソース/ (syubhat) rule: ピザソース contains ソース
  // as a substring, and the tomato/cheese base is halal. /ピザ一ス/ is the
  // observed OCR long-vowel misread (ソー -> 一). Risk ingredients are still
  // flagged by their own rules (e.g. ハム, ベーコン).
  halalRule('pizza-sauce', 'Pizza sauce / ピザソース', [/ピザソース/, /ピザ一ス/], 'condiment', 'Saus pizza umumnya basis tomat/keju; bahan berisiko ditandai terpisah.'),
  {
    id: 'sauce',
    label: 'Sauce / ソース',
    status: 'syubhat',
    confidence: 'low',
    category: 'condiment',
    // /ウスタ/ catches ウスターソース when the long vowel is OCR-misread as the
    // kanji 一 (ウスタ一ース), the same variant family as コーヒ一/パ一ム油.
    // Still syubhat (low): no false halal.
    patterns: [/ソース/, /ウスタ/],
    reasoning: 'Saus (mis. Worcestershire/中濃) bisa mengandung alkohol, ekstrak hewani, atau ikan. Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },

  // --- instant noodles / snacks / bakery / sauces ----------------------------
  halalRule('raising-agent', 'Raising agent / 膨張剤', [/膨張剤/, /膨服剤/, /膨帳剤/, /ベーキングパウダー/, /炭酸水素/, /碳酸氢钠/], 'additive', 'Pengembang (baking powder/soda), halal.'),
  halalRule('kansui', 'Kansui / かんすい', [/かんすい/, /かんす/, /カンスイ/], 'additive', 'Air alkali (kansui) untuk mi, mineral, halal.'),
  halalRule('pectin', 'Pectin / ペクチン', [/ペクチン/], 'additive', 'Pektin buah, halal.'),
  halalRule('agar', 'Agar / 寒天', [/寒天/], 'additive', 'Agar rumput laut, halal.'),
  halalRule('starch-syrup', 'Starch syrup / 水飴', [/水飴/, /水あめ/, /還元水あめ/, /転化糖/, /粉あめ/, /米飴/], 'sweetener', 'Sirup pati, halal.'),
  halalRule('malt', 'Malt / 麦芽', [/麦芽/, /モルト/], 'grain', 'Malt gandum, halal.'),
  halalRule('lactose', 'Lactose / 乳糖', [/乳糖/], 'dairy', 'Laktosa susu, halal.', 'medium'),
  halalRule('cocoa2', 'Cocoa / ココア', [/ココア/, /カカオ/], 'plant', 'Kakao, halal.'),
  halalRule('nuts', 'Nuts / ナッツ', [/ナッツ/, /アーモンド/, /落花生/, /ピーナッツ/, /カシューナッツ/], 'plant', 'Kacang-kacangan, halal.'),
  halalRule('raisin', 'Raisin / レーズン', [/レーズン/], 'plant', 'Kismis, halal.'),
  halalRule('egg-white', 'Egg white / 卵白', [/卵白/], 'animal', 'Putih telur, halal.', 'medium'),
  // Dough conditioner (イーストフード) is a compound additive whose typical
  // members (L-cysteine, emulsifiers, enzymes) are source-dependent per §6.
  // Placed BEFORE the yeast rule so /イースト/ does not grant it a bare halal.
  {
    id: 'yeast-food',
    label: 'Yeast food / イーストフード',
    status: 'syubhat',
    confidence: 'medium',
    category: 'additive',
    patterns: [/イーストフード/],
    reasoning:
      'イーストフード (dough conditioner) adalah campuran aditif; dapat memuat L-sistein, emulsifier, atau enzim yang sumbernya bisa hewani. Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },
  halalRule('yeast', 'Yeast / イースト', [/イースト/, /パン酵母/, /酵母粉末/], 'additive', 'Ragi, halal.'),
  halalRule('noodle', 'Noodle / 麺', [/中華麺/, /油揚げ/, /めん/, /麺/, /即席/], 'grain', 'Mi berbasis gandum, halal.'),
  halalRule('seaweed', 'Seaweed / 海藻', [/海藻/, /わかめ/, /昆布/, /のり/], 'plant', 'Rumput laut, halal.'),
  halalRule('mushroom', 'Mushroom / きのこ', [/きのこ/, /椎茸/, /しいたけ/, /エリンギ/, /しめじ/], 'plant', 'Jamur, halal.'),
  halalRule('konjac', 'Konjac / こんにゃく', [/こんにゃく/, /蒟蒻/], 'plant', 'Konnyaku, halal.'),
  // Placed BEFORE the 豆腐 halal rule: 豆腐用凝固剤 CONTAINS 豆腐 but is a
  // functional class, not tofu itself, so it must not inherit the 豆腐 verdict.
  // Common tofu coagulants are mineral/acid (nigari/MgCl2, calcium sulfate,
  // GDL), but the label does not name the agent, and 凝固剤 elsewhere (e.g.
  // cheese) may be rennet/enzyme — source-dependent per §6 → syubhat.
  {
    id: 'tofu-coagulant',
    label: 'Tofu coagulant / 豆腐用凝固剤',
    status: 'syubhat',
    confidence: 'medium',
    category: 'additive',
    patterns: [/豆腐用凝固/, /豆腐凝固/],
    reasoning:
      'Agen penggumpal tahu umumnya mineral/asam (nigari/MgCl2, kalsium sulfat, GDL) yang halal, tetapi sebutan generik ini tidak menyebut agennya; 凝固剤 pada produk lain (mis. keju) bisa rennet/enzim hewani. Tanpa nama agen → syubhat.',
    sources: [LPPOM, JAKIM],
  },
  halalRule('tofu', 'Tofu / 豆腐', [/豆腐/], 'plant', 'Tahu, halal.'),
  halalRule('chocolate', 'Chocolate / チョコ', [/チョコ/, /カカオマス/, /ココアバター/], 'plant', 'Cokelat; waspadai emulsifier/susu hewani.', 'low'),
  halalRule('biscuit', 'Biscuit / ビスケット', [/ビスケット/, /クッキー/, /ウエハース/, /ワッフル/], 'grain', 'Biskuit; waspadai shortening/margarin hewani.', 'low'),
  halalRule('pudding', 'Pudding / プリン', [/プリン/, /カスタード/], 'dessert', 'Puding (telur/susu); waspadai gelatin.', 'low'),
  halalRule('soup', 'Soup / スープ', [/スープ/], 'seasoning', 'Sup bubuk; umumnya halal, waspadai ekstrak hewani.', 'low'),
  {
    id: 'dressing',
    label: 'Dressing / ドレッシング',
    status: 'syubhat',
    confidence: 'low',
    category: 'condiment',
    patterns: [/ドレッシング/],
    reasoning: 'Dressing bisa mengandung alkohol (cuka/anggur) dan ekstrak hewani. Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },

  // --- frequency-ranked OFF-JP ingredients (top unknown tokens) --------------
  halalRule('glycine', 'Glycine / グリシン', [/グリシン/], 'additive', 'Glisin (asam amino), halal.'),
  halalRule('trehalose', 'Trehalose / トレハロース', [/トレハロース/], 'sweetener', 'Trehalosa, halal.'),
  halalRule('sucralose', 'Sucralose / スクラロース', [/スクラロース/], 'sweetener', 'Sukralosa (sintetis), halal.'),
  halalRule('sugars', 'Sugars / 糖類', [/^糖類$/, /砂糖類/], 'sweetener', 'Gula, halal.'),
  halalRule('acesulfame', 'Acesulfame K / アセスルファムK', [/アセスルファム/], 'sweetener', 'Pemanis sintetis, halal.'),
  halalRule('sodium-acetate', 'Sodium acetate / 酢酸Na', [/酢酸na/, /酢酸ナトリウム/], 'additive', 'Natrium asetat, halal.'),
  halalRule('xanthan', 'Xanthan / キサンタン', [/キサンタン/], 'additive', 'Xanthan gum (fermentasi), halal.'),
  halalRule('stevia', 'Stevia / ステビア', [/ステビア/], 'sweetener', 'Stevia (nabati), halal.'),
  halalRule('brewed-vinegar', 'Brewed vinegar / 醸造酢', [/醸造酢/], 'fermented', 'Cuka fermentasi, halal.'),
  halalRule('niacin', 'Niacin / ナイアシン', [/ナイアシン/], 'additive', 'Niasin (vitamin), halal.'),
  halalRule('aspartame', 'Aspartame / アスパルテーム', [/アスパルテーム/], 'sweetener', 'Aspartam (asam amino), halal.'),
  halalRule('turmeric', 'Turmeric / ウコン', [/ウコン/], 'plant', 'Kunyit (nabati), halal.'),
  halalRule('baking-soda', 'Baking soda / 重曹', [/重曹/], 'additive', 'Soda kue (mineral), halal.'),
  halalRule('acetic-acid', 'Acetic acid / 酢酸', [/酢酸/], 'additive', 'Asam asetat, halal.'),
  halalRule('kcl', 'Potassium chloride / 塩化K', [/塩化k/, /塩化カリウム/], 'additive', 'Kalium klorida (mineral), halal.'),
  halalRule('carotenoid', 'Carotenoid / カロテノイド', [/カロチン/, /カロテン/, /カロテノイド/, /カロチノイド/], 'colorant', 'Karotenoid (nabati), halal.'),
  // Bare /ソルビン酸/ added after the real-image run: ソルビン酸 (sorbic acid,
  // E200) and all its salts are halal synthetic preservatives, but only the K
  // salt was covered, so the bare token fuzzy-matched カルミン酸 (carmine,
  // syubhat) and reported a false syubhat on a halal preservative.
  halalRule('potassium-sorbate', 'Potassium sorbate / ソルビン酸K', [/ソルビン酸/, /ソルビン酸カリウム/], 'additive', 'Asam sorbat dan garamnya, halal.'),
  halalRule('annatto', 'Annatto / アナトー', [/アナトー/], 'colorant', 'Annatto (nabati), halal.'),
  halalRule('red-koji', 'Red koji / 紅麹', [/紅麹/, /ベニコウジ/], 'additive', 'Koji merah (fermentasi), halal.'),
  halalRule('matcha', 'Matcha / 抹茶', [/抹茶/], 'plant', 'Matcha (teh), halal.'),
  halalRule('green-tea', 'Green tea / 緑茶', [/緑茶/], 'plant', 'Teh hijau, halal.'),
  halalRule('coffee', 'Coffee / コーヒー豆', [/コーヒー豆/, /コーヒー/], 'plant', 'Kopi, halal.'),
  halalRule('azuki', 'Azuki / 小豆', [/小豆/], 'plant', 'Kacang azuki, halal.'),
  halalRule('rice-uruchi', 'Rice / うるち米', [/うるち米/, /もち米/], 'plant', 'Beras, halal.'),
  halalRule('white-sugar', 'White sugar / 白砂糖', [/白砂糖/], 'sweetener', 'Gula putih, halal.'),
  halalRule('fruit', 'Fruit / 果実', [/果実/], 'plant', 'Buah, halal.'),
  halalRule('leek', 'Leek / ねぎ', [/ねぎ/, /ネギ/], 'plant', 'Bawang daun, halal.'),
  halalRule('parsley', 'Parsley / パセリ', [/パセリ/], 'plant', 'Peterseli, halal.'),
  halalRule('broccoli', 'Broccoli / ブロッコリー', [/ブロッコリー/], 'plant', 'Brokoli, halal.'),
  halalRule('lettuce', 'Lettuce / レタス', [/レタス/], 'plant', 'Selada, halal.'),
  halalRule('apple', 'Apple / りんご', [/りんご/, /リンゴ/], 'plant', 'Apel, halal.'),
  halalRule('orange', 'Orange / オレンジ', [/オレンジ/], 'plant', 'Jeruk, halal.'),
  halalRule('licorice', 'Licorice / 甘草', [/甘草/, /カンゾウ/], 'plant', 'Akar manis, halal.'),
  halalRule('mackerel', 'Mackerel / さば', [/さば/, /サバ/], 'animal', 'Ikan kembung, halal (hasil laut).'),
  halalRule('salmon', 'Salmon / さけ', [/さけ/, /サケ/, /鮭/], 'animal', 'Ikan salmon, halal (hasil laut).'),
  halalRule('shrimp', 'Shrimp / えび', [/えび/, /エビ/, /海老/], 'animal', 'Udang, halal (hasil laut).'),
  halalRule('squid', 'Squid / いか', [/いか/, /イカ/, /烏賊/], 'animal', 'Cumi, halal (hasil laut).'),
  halalRule('alginate', 'Alginate / アルギン酸', [/アルギン酸/], 'additive', 'Alginat rumput laut, halal.'),
  halalRule('gardenia', 'Gardenia / クチナシ', [/クチナシ/], 'colorant', 'Pewarna gardenia (nabati), halal.'),
  halalRule('paprika-color', 'Paprika colour / パプリカ色素', [/パプリカ/], 'colorant', 'Pewarna paprika (nabati), halal.'),
  halalRule('veg-color', 'Vegetable colour / 野菜色素', [/野菜色素/], 'colorant', 'Pewarna nabati, halal.'),
  halalRule('nitrite', 'Sodium nitrite / 亜硝酸Na', [/亜硝酸na/, /亜硝酸ナトリウム/], 'additive', 'Natrium nitrit (mineral), halal.'),
  halalRule('propionate', 'Calcium propionate / プロピオン酸Ca', [/プロピオン酸/, /丙酸钙/], 'additive', 'Propionat (pengawet mineral), halal.'),
  // OCR read く as "<" (observed). normalize() strips "<", so the normalized
  // form is just ん液 — /ん液/ is what actually catches the garble; the literal
  // /<ん液/ is kept for raw-pattern documentation.
  halalRule('smoke', 'Smoke flavour / くん液', [/くん液/, /燻液/, /<ん液/, /ん液/], 'additive', 'Cairan asap, halal.'),
  halalRule('phenylalanine', 'Phenylalanine', [/フェニルアラニン/], 'additive', 'Fenilalanin (asam amino), halal.'),
  halalRule('expanding2', 'Raising agent / 膨脹剤', [/膨脹剤/], 'additive', 'Pengembang, halal.'),
  halalRule('salt-cn', 'Salt / 食用塩', [/食用塩/, /食用盐/], 'mineral', 'Garam, halal.'),
  halalRule('sweetener2', 'Sweetener / 甘味料', [/甘味料/], 'sweetener', 'Pemanis; umumnya halal, waspadai varian.', 'low'),
  halalRule('stabilizer', 'Stabilizer / 安定剤', [/安定剤/], 'additive', 'Penstabil; umumnya nabati/mikroba.', 'low'),
  halalRule('preservative2', 'Preservative / 保存料', [/保存料/], 'additive', 'Pengawet; umumnya halal (sorbat/benzoat).', 'low'),
  // Halal coagulants exist (mineral salts/acids, e.g. nigari), but the bare
  // functional class can also be rennet/enzyme (source-dependent per §6) and the
  // label rarely names the agent, so the generic term is syubhat.
  {
    id: 'coagulant',
    label: 'Coagulant / 凝固剤',
    status: 'syubhat',
    confidence: 'medium',
    category: 'additive',
    patterns: [/凝固剤/],
    reasoning:
      'Koagulan generik (mis. pada tahu/keju) bisa mineral/asam (halal) atau rennet/enzim hewani. Tanpa nama agen, syubhat.',
    sources: [LPPOM, JAKIM],
  },
  halalRule('flavor-oil', 'Flavour oil / 香味油', [/香味油/], 'fat', 'Minyak aroma; umumnya nabati.', 'low'),
  halalRule('dairy', 'Dairy / 乳製品', [/乳製品/, /乳由来/], 'dairy', 'Produk susu; halal, waspadai enzim.', 'low'),
  halalRule('condensed-milk', 'Condensed milk / 加糖練乳', [/加糖練乳/, /練乳/, /加糖れん乳/, /れん乳/], 'dairy', 'Susu kental manis, halal.', 'low'),
  halalRule('dairy-based', 'Dairy-based food', [/乳等を主要原料/], 'dairy', 'Pangan berbasis susu; halal, waspadai enzim.', 'low'),
  halalRule('oligosaccharide', 'Oligosaccharide / オリゴ糖', [/オリゴ糖/], 'sweetener', 'Oligosakarida, halal.'),
  halalRule('safflower', 'Safflower / 紅花', [/紅花/], 'colorant', 'Pewarna safflower (nabati), halal.'),
  halalRule('barley', 'Barley / 大麦', [/大麦/], 'grain', 'Jelai (nabati), halal.'),
  halalRule('ferment-starter', 'Fermentation starter / 発酵種', [/発酵種/], 'additive', 'Starter fermentasi, halal.', 'low'),
  halalRule('carrageenan2', 'Carrageenan / カラギナン', [/カラギナン/], 'additive', 'Karagenan rumput laut, halal.'),
  halalRule('milk-protein', 'Milk protein / 乳たん白', [/乳たん白/, /乳たんぱく/], 'dairy', 'Protein susu, halal.', 'low'),
  halalRule('mgcl', 'Magnesium chloride / 塩化Mg', [/塩化mg/, /塩化マグネシウム/], 'additive', 'Magnesium klorida (mineral), halal.'),
  halalRule('sucrose-ester', 'Sucrose ester / ショ糖エステル', [/ショ糖エステル/, /ショ糖脂肪酸/], 'additive', 'Ester sukrosa (nabati), halal.'),
  {
    id: 'monoglyceride',
    label: 'Mono/diglycerides / モノグリセリド',
    status: 'syubhat',
    confidence: 'medium',
    category: 'additive',
    patterns: [/モノグリセリド/, /グリセリン脂肪酸/, /单双甘油脂肪酸酯/, /甘油脂肪酸酯/],
    reasoning: 'Mono/diglyceride (E471) bisa dari lemak nabati atau hewani (termasuk babi). Tanpa keterangan sumber syubhat.',
    sources: ['EFSA — E471', LPPOM],
  },
  halalRule('skim-condensed', 'Skim condensed milk', [/脱脂濃縮乳/, /脱脂乳/], 'dairy', 'Susu skim, halal.', 'low'),
  halalRule('pumpkin', 'Pumpkin / かぼちゃ', [/かぼちゃ/, /カボチャ/], 'plant', 'Labu, halal.'),
  halalRule('spinach', 'Spinach / ほうれん草', [/ほうれん草/, /ホウレンソウ/], 'plant', 'Bayam, halal.'),
  halalRule('xylose', 'Xylose / キシロース', [/キシロース/], 'sweetener', 'Xilosa, halal.'),
  halalRule('crab', 'Crab / かに', [/かに/, /カニ/, /蟹/], 'animal', 'Kepiting, halal (hasil laut).'),
  halalRule('burdock', 'Burdock / ごぼう', [/ごぼう/, /ゴボウ/], 'plant', 'Burdock, halal.'),
  halalRule('hops', 'Hops / ホップ', [/ホップ/], 'plant', 'Hop (nabati), halal.'),
  {
    id: 'processed-fat',
    label: 'Processed fat / 油脂加工品',
    status: 'syubhat',
    confidence: 'low',
    category: 'fat',
    patterns: [/油脂加工品/, /油脂加工食品/, /加工油脂/, /粉末油脂/, /食用油脂/],
    reasoning: 'Lemak/minyak olahan bisa hewani (termasuk babi) atau nabati. Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },

  // --- backlog round: safety-critical negatives + high-frequency halal -------
  // Ordering note: the generic 乳化 rule below MUST stay after the curated
  // 乳化剤 entry and the emulsifier rule so those specific matches win first.
  // NOTE: fat-generic is anchored (^油脂$ etc.) so it can never swallow
  // 植物油脂/食用植物油脂 (veg-oil, halal). Order is no longer load-bearing.
  {
    id: 'spirits',
    label: 'Spirits / スピリッツ',
    status: 'haram',
    confidence: 'high',
    category: 'alcohol',
    patterns: [/スピリッツ/],
    reasoning: 'スピリッツ (spirits) adalah minuman beralkohol (khamr), haram.',
    sources: ["QS Al-Maa'idah 5:90", LPPOM],
  },
  {
    id: 'powdered-alcohol',
    label: 'Powdered alcohol / 粉末酒',
    status: 'haram',
    confidence: 'high',
    category: 'alcohol',
    patterns: [/粉末酒/],
    reasoning: '粉末酒 (alkohol bubuk) mengandung etanol, haram.',
    sources: ["QS Al-Maa'idah 5:90", LPPOM],
  },
  {
    id: 'animal-fat',
    label: 'Animal fat / 動物油脂',
    status: 'syubhat',
    confidence: 'medium',
    category: 'fat',
    // Non-duplicated only: 動物油脂/動物性油脂 now live in the early animal-plant-fat rule.
    patterns: [/調味動物油脂/],
    reasoning: 'Lemak/minyak hewani tanpa keterangan spesies atau sembelihan syar\'i. Syubhat.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'fond-de-veau',
    label: 'Fond de veau / フォンドボー',
    status: 'syubhat',
    confidence: 'medium',
    category: 'animal',
    patterns: [/フォンドボー/],
    reasoning: 'フォンドボー (kaldu tulang sapi/veal) berasal dari hewani tanpa jaminan sembelihan syar\'i. Syubhat.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'gum-base',
    label: 'Gum base / ガムベース',
    status: 'syubhat',
    confidence: 'medium',
    category: 'additive',
    patterns: [/ガムベース/],
    reasoning: 'Gum base permen karet dapat memakai gliserol/ester turunan hewani (termasuk babi). Syubhat.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'emulsify-fragment',
    label: 'Emulsify / 乳化',
    status: 'syubhat',
    confidence: 'low',
    category: 'additive',
    patterns: [/乳化/],
    reasoning: 'Fragmen 乳化 (mis. 乳化油脂) menandakan emulsifier yang sumbernya bisa hewani/nabati. Syubhat.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'fat-generic',
    label: 'Fat/oil / 油脂',
    status: 'syubhat',
    confidence: 'low',
    category: 'fat',
    // Anchored on purpose: bare /油脂/ also matches 植物油脂 (halal via veg-oil)
    // and 食用植物油脂. Only exact generic forms belong here; 加工油脂/加工油脂等
    // keep their own earlier rule (processed-fat). This removes the order
    // dependency instead of relying on veg-oil being defined first.
    patterns: [/^油脂$/, /^動植物油脂$/, /^食用油脂$/],
    reasoning: 'Fragmen 油脂 generik bisa hewani (termasuk babi) atau nabati. Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },
  halalRule('molasses', 'Molasses / 糖蜜', [/糖蜜/], 'sweetener', 'Tetes tebu (nabati), halal.'),
  halalRule('rice-bran-oil', 'Rice bran oil / 米油', [/米油/], 'fat', 'Minyak bekatul (nabati), halal.'),
  halalRule('rice-bran', 'Rice bran / 米ぬか', [/米ぬか/], 'plant', 'Bekatul (nabati), halal.'),
  halalRule('monaka', 'Monaka / モナカ', [/モナカ/], 'grain', 'Wafer monaka (tepung/beras), halal.'),
  halalRule('nonfat-milk-solids', 'Nonfat milk solids / 無脂乳固形分', [/無脂乳固形分/], 'dairy', 'Padatan susu tanpa lemak, halal.'),
  halalRule('bean-sprouts', 'Bean sprouts / もやし', [/もやし/], 'plant', 'Tauge (nabati), halal.'),
  halalRule('papaya', 'Papaya / パパイヤ', [/パパイヤ/], 'plant', 'Pepaya (buah), halal.'),
  halalRule('cranberry', 'Cranberry / クランベリー', [/クランベリー/], 'plant', 'Cranberry (buah), halal.'),
  halalRule('purple-sweet-potato', 'Purple sweet potato / 紫いも', [/紫いも/], 'plant', 'Ubi ungu (nabati), halal.'),
  halalRule('ashitaba', 'Ashitaba / あしたば', [/あしたば/], 'plant', 'Ashitaba (nabati), halal.'),
  halalRule('petit-vert', 'Petit vert / プチヴェール', [/プチヴェール/], 'plant', 'Petit vert (sayur), halal.'),
  halalRule('oat-puff', 'Oat puff / オーツパフ', [/オーツパフ/], 'grain', 'Oat puff (biji-bijian), halal.'),
  halalRule('cereal-flakes', 'Cereal flakes / シリアルフレーク', [/シリアルフレーク/], 'grain', 'Sereal flake (biji-bijian), halal.'),
  halalRule('potato-flakes', 'Potato flakes / ポテトフレーク', [/ポテトフレーク/], 'plant', 'Kentang flake (nabati), halal.'),
  halalRule('dried-potato', 'Dried potato / 乾燥ポテト', [/乾燥ポテト/], 'plant', 'Kentang kering (nabati), halal.'),
  halalRule('vegetable-paste', 'Vegetable paste / 野菜ペースト', [/野菜ペースト/], 'plant', 'Pasta sayur (nabati), halal.'),
  halalRule('mineral-sources', 'Mineral sources / 深井戸水', [/深井戸水/, /海水/, /天日塩/], 'mineral', 'Sumber air/garam mineral, halal.'),

  // --- tail batch 2 (frequency-ranked) ---------------------------------------
  halalRule('rosemary', 'Rosemary extract / ローズマリー', [/ローズマリー/], 'additive', 'Ekstrak rosemary (nabati), halal.'),
  halalRule('asparagus', 'Asparagus / アスパラガス', [/アスパラガス/, /アスパラ/], 'plant', 'Asparagus, halal.'),
  halalRule('celery', 'Celery / セロリ', [/セロリ/], 'plant', 'Seledri, halal.'),
  halalRule('sulfite', 'Sulfite / 亜硫酸塩', [/亜硫酸/], 'additive', 'Sulfit (mineral), halal.'),
  halalRule('olive-oil', 'Olive oil / オリーブ油', [/オリーブ油/, /オリーブオイル/], 'fat', 'Minyak zaitun, halal.'),
  halalRule('mineral-water', 'Mineral water / 鉱水', [/鉱水/, /ミネラルウォーター/], 'mineral', 'Air mineral, halal.'),
  halalRule('mix-flour', 'Mixed flour / ミックス粉', [/ミックス粉/], 'grain', 'Campuran tepung; umumnya halal.', 'low'),
  halalRule('daikon', 'Daikon / だいこん', [/だいこん/, /ダイコン/, /大根/], 'plant', 'Lobak putih, halal.'),
  halalRule('black-tea', 'Black tea / 紅茶', [/紅茶/], 'plant', 'Teh hitam, halal.'),
  halalRule('watercress', 'Watercress / クレソン', [/クレソン/], 'plant', 'Selada air, halal.'),
  // NB: never bare /もも/ — 豚もも肉/鶏もも肉 are MEAT CUTS and this rule made
  // them halal (verifier round 5). Peach never appears as もも肉.
  halalRule('peach', 'Peach / もも', [/もも(?!肉)/, /モモ(?!肉)/, /桃/], 'plant', 'Persik, halal.'),
  halalRule('arginine', 'Arginine / アルギニン', [/アルギニン/], 'additive', 'Arginin (asam amino), halal.'),
  halalRule('isoleucine', 'Isoleucine / イソロイシン', [/イソロイシン/], 'additive', 'Isoleusin (asam amino), halal.'),
  halalRule('napa', 'Napa cabbage / はくさい', [/はくさい/, /ハクサイ/, /白菜/], 'plant', 'Sawi putih, halal.'),
  halalRule('komatsuna', 'Komatsuna / 小松菜', [/小松菜/], 'plant', 'Komatsuna, halal.'),
  halalRule('rye', 'Rye / ライ麦', [/ライ麦/], 'grain', 'Gandum hitam, halal.'),
  halalRule('kale', 'Kale / ケール', [/ケール/], 'plant', 'Kale, halal.'),
  halalRule('gum-arabic', 'Gum arabic / アラビアガム', [/アラビアガム/], 'additive', 'Gum arab (nabati), halal.'),
  halalRule('sweet-potato', 'Sweet potato / さつまいも', [/さつまいも/, /サツマイモ/], 'plant', 'Ubi jalar, halal.'),
  halalRule('strawberry', 'Strawberry / いちご', [/いちご/, /イチゴ/, /苺/], 'plant', 'Stroberi, halal.'),
  halalRule('kinako', 'Kinako / きな粉', [/きな粉/, /きなこ/], 'plant', 'Tepung kedelai, halal.'),
  halalRule('rice-koji', 'Rice koji / 米こうじ', [/米こうじ/, /米麹/], 'additive', 'Koji beras (fermentasi), halal.'),
  halalRule('lysozyme', 'Lysozyme / リゾチーム', [/リゾチーム/], 'additive', 'Lisozim (umumnya dari putih telur), halal.', 'medium'),
  halalRule('arare', 'Arare / あられ', [/あられ/], 'grain', 'Kerupuk beras; umumnya halal.', 'low'),
  halalRule('nori', 'Nori / 海苔', [/海苔/, /のり/, /あおさ/], 'plant', 'Rumput laut, halal.'),
  halalRule('kombu', 'Kombu / こんぶ', [/こんぶ/, /コンブ/], 'plant', 'Kombu, halal.'),
  halalRule('walnut', 'Walnut / くるみ', [/くるみ/, /クルミ/, /胡桃/], 'plant', 'Kenari, halal.'),
  halalRule('garlic-powder', 'Garlic powder / ガーリック', [/ガーリック/], 'plant', 'Bawang putih bubuk, halal.'),
  halalRule('seasoning-granule', 'Seasoning / 調味顆粒', [/調味顆粒/], 'additive', 'Bumbu butiran; umumnya halal.', 'low'),
  {
    id: 'bacon',
    label: 'Bacon / ベーコン',
    status: 'haram',
    confidence: 'high',
    category: 'animal',
    patterns: [/ベーコン/],
    reasoning: 'Bacon umumnya dari daging babi, haram. (Bila dari sapi/ayam, tetap perlu sembelihan syar\'i.)',
    sources: ['QS Al-Baqarah 2:173', LPPOM],
  },
  {
    id: 'tare',
    label: 'Tare / たれ',
    status: 'syubhat',
    confidence: 'low',
    category: 'condiment',
    patterns: [/たれ/, /タレ/],
    reasoning: 'Saus tare bisa mengandung alkohol, kecap, atau ekstrak hewani. Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },
  // --- tail batch 3 ----------------------------------------------------------
  halalRule('cauliflower', 'Cauliflower / カリフラワー', [/カリフラワー/], 'plant', 'Kembang kol, halal.'),
  halalRule('bell-pepper', 'Bell pepper / ピーマン', [/ピーマン/], 'plant', 'Paprika bell, halal.'),
  halalRule('oats', 'Oats / オーツ麦', [/オーツ麦/, /オートミール/], 'grain', 'Oat, halal.'),
  halalRule('anthocyanin', 'Anthocyanin / アントシアニン', [/アントシアニン/], 'colorant', 'Antosianin (nabati), halal.'),
  halalRule('inulin', 'Inulin / イヌリン', [/イヌリン/], 'additive', 'Inulin (nabati), halal.'),
  halalRule('sodium-benzoate', 'Sodium benzoate / 安息香酸Na', [/安息香酸na/, /安息香酸ナトリウム/], 'additive', 'Natrium benzoat, halal.'),
  halalRule('antifoam', 'Antifoam / 消泡剤', [/消泡剤/], 'additive', 'Antibusa (umumnya silikon/mineral), halal.', 'low'),
  halalRule('fermented-milk', 'Fermented milk / 発酵乳', [/発酵乳/], 'dairy', 'Susu fermentasi; halal, waspadai enzim.', 'low'),
  halalRule('milk-fat', 'Milk fat / 乳脂肪', [/乳脂肪/], 'dairy', 'Lemak susu, halal.', 'low'),
  halalRule('powdered-sugar', 'Powdered sugar / 粉糖', [/粉糖/, /粉砂糖/], 'sweetener', 'Gula bubuk, halal.'),
  halalRule('mochi-flour', 'Mochi flour / もち粉', [/もち粉/], 'grain', 'Tepung mochi, halal.'),
  halalRule('cooked-rice', 'Cooked rice / ご飯', [/ご飯/, /ごはん/], 'grain', 'Nasi, halal.'),
  // /鰹/ + /かつお/ cover extracts/dashes not caught by the exact curated
  // 'bonito' entry (e.g. 鰹エキス) and keep them halal instead of falling to the
  // generic エキス syubhat rule.
  // /カツオ/ (katakana) MUST be covered too: the カツ扱/力ツ扱 OCR folds in
  // normalize.ts produce カツオ…, and without this the folded カツオエキス fell
  // to the generic エキス (syubhat) and カツオ節粉末 stayed unmatched. Bonito is a
  // fish — halal. The meat-cut rule explicitly excludes カツオ.
  halalRule('katsuobushi', 'Katsuobushi / 鰹節', [/鰹節/, /かつお節/, /鰹/, /かつお/, /カツオ/], 'animal', 'Ikan cakalang kering, halal (hasil laut).'),
  halalRule('leucine', 'Leucine / ロイシン', [/ロイシン/], 'additive', 'Leusin (asam amino), halal.'),
  halalRule('valine', 'Valine / バリン', [/バリン/], 'additive', 'Valin (asam amino), halal.'),
  halalRule('drinking-water', 'Drinking water / 飲用水', [/饮用水/, /飲用水/], 'mineral', 'Air minum, halal.'),
  halalRule('green-leaf', 'Green leaf / グリーンリーフ', [/グリーンリーフ/], 'plant', 'Selada hijau, halal.'),
  {
    id: 'shochu',
    label: 'Shochu / 焼酎',
    status: 'haram',
    confidence: 'high',
    category: 'alcohol',
    patterns: [/焼酎/],
    reasoning: '焼酎 adalah minuman beralkohol (khamr), haram.',
    sources: ["QS Al-Maa'idah 5:90", LPPOM],
  },
  {
    id: 'potato-salad',
    label: 'Potato salad / ポテトサラダ',
    status: 'syubhat',
    confidence: 'low',
    category: 'condiment',
    patterns: [/ポテトサラダ/],
    reasoning: 'Salad kentang biasanya mengandung mayones; waspadai aditif/emulsifier.',
    sources: [LPPOM],
  },
  {
    id: 'western-liquor',
    label: 'Western liquor / 洋酒',
    status: 'haram',
    confidence: 'high',
    category: 'alcohol',
    patterns: [/洋酒/],
    reasoning: '洋酒 adalah minuman beralkohol (khamr), haram.',
    sources: ["QS Al-Maa'idah 5:90", LPPOM],
  },
  {
    id: 'enzyme',
    label: 'Enzyme / 酵素',
    status: 'syubhat',
    confidence: 'medium',
    category: 'enzyme',
    patterns: [/酵素/],
    reasoning: 'Enzim dapat berasal dari hewan (termasuk babi) atau mikroba. Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'gelling-agent',
    label: 'Gelling agent / ゲル化剤',
    status: 'syubhat',
    confidence: 'low',
    category: 'additive',
    patterns: [/ゲル化剤/],
    reasoning: 'Gelling agent bisa agar/pektin (halal) atau gelatin (bergantung sumber). Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'glazing-agent',
    label: 'Glazing agent / 光沢剤',
    status: 'syubhat',
    confidence: 'low',
    category: 'additive',
    patterns: [/光沢剤/],
    reasoning: 'Pelapis bisa lilin (halal) atau shellac (serangga). Perlu verifikasi.',
    sources: ['EFSA — E904', LPPOM],
  },
  {
    id: 'fat-spread',
    label: 'Fat spread / ファットスプレッド',
    status: 'syubhat',
    confidence: 'medium',
    category: 'fat',
    patterns: [/ファットスプレッド/],
    reasoning: 'Lemak olesan bisa berbasis hewani (termasuk babi) atau nabati.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'caseinate',
    label: 'Sodium caseinate / カゼインNa',
    status: 'syubhat',
    confidence: 'medium',
    category: 'dairy',
    patterns: [/カゼインna/, /カゼインナトリウム/],
    reasoning: 'Kaseinat susu; halal bila susu halal & bebas enzim haram. Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'sorbitol2',
    label: 'Sorbitol / ソルビット',
    status: 'syubhat',
    confidence: 'medium',
    category: 'additive',
    patterns: [/ソルビット/, /山梨糖醇/],
    reasoning: 'Sorbitol umumnya dari glukosa, tetapi MUIS menandai E420 syubhah. Hati-hati.',
    sources: ['MUIS Food Additive Listing (2016)'],
  },
  {
    id: 'creaming-powder',
    label: 'Creaming powder / クリーミングパウダー',
    status: 'syubhat',
    confidence: 'low',
    category: 'dairy',
    // /クー三グパウダ/ is the observed PaddleOCR misread of クリーミングパウダー
    // (ミ -> 三, off2_4901360354856); without it the token fell to the catalog as
    // unknown despite the explicit syubhat rule.
    patterns: [/クリーミングパウダー/, /クー三グパウダ/],
    reasoning: 'Krimer bubuk bisa mengandung lemak hewani/emulsifier. Perlu verifikasi.',
    sources: [LPPOM, JAKIM],
  },
  {
    id: 'color-developer',
    label: 'Colour developer / 発色剤',
    status: 'halal',
    confidence: 'low',
    category: 'additive',
    patterns: [/発色剤/],
    reasoning: 'Pengembang warna (mis. nitrit) umumnya halal; dagingnya yang perlu dicek.',
    sources: ['EFSA — E250', LPPOM],
  },

  // --- unlabelled fresh foods (audited gaps) ---------------------------------
  halalRule('pineapple', 'Pineapple / パイナップル', [/パイナップル/], 'plant', 'Nanas (buah), halal.'),
  halalRule('basil', 'Basil / バジル', [/バジル/], 'plant', 'Kemangi (herba), halal.'),
  halalRule('cinnamon', 'Cinnamon / シナモン', [/シナモン/], 'plant', 'Kayu manis (rempah), halal.'),
  halalRule('eggplant', 'Eggplant / なす', [/なす/], 'plant', 'Terong (sayur), halal.'),
  halalRule('soba', 'Soba / そば', [/そば/], 'plant', 'Soba/buckwheat (biji-bijian), halal.'),
  halalRule('ikura', 'Salmon roe / いくら', [/いくら/, /イクラ/], 'animal', 'Telur ikan salmon (hasil laut), halal.'),
  halalRule('tarako', 'Cod roe / たらこ', [/たらこ/, /タラコ/], 'animal', 'Telur ikan kod/pollock (hasil laut), halal.'),

  {
    id: 'generic-extract',
    label: 'Extract / エキス',
    status: 'syubhat',
    confidence: 'low',
    category: 'additive',
    patterns: [/エキス/],
    reasoning:
      'Ekstrak generik (nama tanpa sumber). Bisa nabati atau hewani; tanpa keterangan syubhat. (Ekstrak ragi/酵母エキス punya entri tersendiri = halal.)',
    sources: [LPPOM],
  },
];

/**
 * First matching rule for a normalized token, or null.
 * Rules are evaluated in array order (specific -> generic).
 */
export function matchRule(normalized: string): CurationRule | null {
  if (!normalized) return null;
  for (const rule of CURATION_RULES) {
    for (const p of rule.patterns) {
      if (p.test(normalized)) return rule;
    }
  }
  return null;
}

/** Turn a matched rule into a MatchResult for a raw token. */
export function ruleToMatch(rule: CurationRule, raw: string): MatchResult {
  const entry: IngredientEntry = {
    id: `rule:${rule.id}`,
    names: [raw],
    status: rule.status,
    confidence: rule.confidence,
    basis: rule.basis ?? 'japan-label-rule',
    reviewed: true,
    category: rule.category,
    reasoning: rule.reasoning,
    sources: rule.sources,
  };
  return { entry, matchedTerm: raw, score: 1, kind: 'exact' };
}
