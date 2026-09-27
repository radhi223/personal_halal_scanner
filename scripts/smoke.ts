/**
 * Node smoke test for the matching core (no native modules involved).
 * Run: npx tsx scripts/smoke.ts
 */
import {
  getCatalogIndex,
  getCuratedIndex,
  loadCatalog,
  loadCurated,
  loadDatabase,
} from '@/lib/database';
import { clampRect, computeIngredientCrop, scaleRect } from '@/lib/autoCrop';
import { FORBIDDEN_CHEAP_PAIRS, substitutionCost } from '@/lib/confusion';
import { similarity, weightedSimilarity } from '@/lib/levenshtein';
import { analyzeLayered, analyzeText, buildIndex, matchTerm } from '@/lib/matcher';
import { CURATION_RULES, matchRule } from '@/lib/rules';
import {
  extractCandidates,
  extractIngredientSection,
  isCropBoundary,
  isLabelNoise,
  normalize,
} from '@/lib/normalize';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected ${e}\n      actual   ${a}`);
}

// 1. Normalization: half-width katakana -> full-width, punctuation/space stripped.
check('normalize half-width katakana', normalize('ｾﾞﾗﾁﾝ'), 'ゼラチン');
check('normalize full-width latin', normalize('ｱﾙｺｰﾙ'), 'アルコール');
check('normalize strips punctuation/space', normalize('豚肉、 ソルビトール。'), '豚肉ソルビトール');

// 2. Candidate extraction from a realistic OCR line.
const candidates = extractCandidates('原材料名：豚肉、ゼラチン、砂糖、乳化剤（大豆由来）');
console.log('candidates:', candidates);

const index = buildIndex(loadDatabase().entries);

// 3. Exact matches.
check('exact pork -> haram', matchTerm(index, '豚肉')?.entry.status, 'haram');
check('exact gelatin -> syubhat', matchTerm(index, 'ゼラチン')?.entry.status, 'syubhat');
check('exact sugar -> halal', matchTerm(index, '砂糖')?.entry.status, 'halal');
check('exact soy lecithin -> halal', matchTerm(index, '大豆レシチン')?.entry.status, 'halal');

// 4. Fuzzy match for OCR typos.
const fuzzy = matchTerm(index, 'ゼラチソ'); // ソ instead of ン
check('fuzzy typo -> gelatin', fuzzy?.entry.id, 'gelatin');
check('fuzzy kind', fuzzy?.kind, 'fuzzy');

// 4b. Safety: short terms must not fuzzy-match across different meanings.
check('exact beef -> syubhat (JP slaughter)', matchTerm(index, '牛肉')?.entry.status, 'syubhat');
check('short term typo -> no fuzzy', matchTerm(index, '牛内'), null);

// 5. Full pipeline collapses duplicates and keeps matches.
const findings = analyzeText(index, '原材料名：豚肉、ゼラチン、砂糖、乳化剤（大豆由来）、ぶどう糖');
const matchedIds = findings.filter((f) => f.match).map((f) => f.match!.entry.id).sort();
console.log('pipeline matched:', matchedIds);
check('pipeline has pork', matchedIds.includes('pork'), true);
check('pipeline has gelatin', matchedIds.includes('gelatin'), true);
check('pipeline has glucose', matchedIds.includes('glucose'), true);

// 6. Unknown token should not match.
check('unknown token -> no match', matchTerm(index, '謎の物質XYZ'), null);

// 7. Two-layer: curated statuses win; catalog fills in recognised-but-unreviewed names.
const catalog = loadCatalog();
check('catalog has >8000 entries', catalog.entries.length > 8000, true);

const layered = analyzeLayered(getCuratedIndex(), getCatalogIndex(), '原材料名：豚肉、ココア、砂糖');
const byId = new Map(layered.filter((f) => f.match).map((f) => [f.match!.entry.id, f.match!]));
check('layered: pork stays curated haram', byId.get('pork')?.entry.status, 'haram');
check('layered: sugar stays curated halal', byId.get('sugar')?.entry.status, 'halal');

check('catalog match is unreviewed', matchTerm(getCatalogIndex(), 'ココア')?.entry.reviewed, false);

// 8. Schema lock: every curated entry has confidence/basis/reviewed populated.
const curatedEntries = loadCurated().entries;
const schemaOk = curatedEntries.every(
  (e) =>
    ['high', 'medium', 'low'].includes(e.confidence) &&
    e.reviewed === true &&
    !!e.basis
);
check('curated schema fields populated', schemaOk, true);
check('curated confidence defaults to high', matchTerm(index, '砂糖')?.entry.confidence, 'high');

// 9. Japan-label rule layer (curated > rules > catalog).
const ruleScan = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  '原材料名：料理酒、動物性エキス、コチニール色素、酵母エキス、酒粕、謎エキス100'
);
const byRaw = new Map(ruleScan.filter((f) => f.match).map((f) => [f.raw, f.match!]));
check('料理酒 -> syubhat', byRaw.get('料理酒')?.entry.status, 'syubhat');
check('動物性エキス -> syubhat', byRaw.get('動物性エキス')?.entry.status, 'syubhat');
check('コチニール色素 -> syubhat', byRaw.get('コチニール色素')?.entry.status, 'syubhat');
check('酵母エキス stays halal (curated beats rule)', byRaw.get('酵母エキス')?.entry.status, 'halal');
check('generic 謎エキス -> rule syubhat', byRaw.get('謎エキス100')?.entry.id, 'rule:generic-extract');
check('酒粕 -> syubhat', byRaw.get('酒粕')?.entry.status, 'syubhat');

// 10. E-number table (MUIS-arbitrated) merged into the curated layer.
const ecodeEntries = curatedEntries.filter((e) => e.id.startsWith('ecode:'));
check('ecode table loaded (>700)', ecodeEntries.length > 700, true);
check('E100 -> halal (all agree)', matchTerm(index, 'E100')?.entry.status, 'halal');
check('E120 -> syubhat (conflict)', matchTerm(index, 'E120')?.entry.status, 'syubhat');
check('E120 basis conflict', matchTerm(index, 'E120')?.entry.basis, 'conflict');
check('E471 -> syubhat (MUIS)', matchTerm(index, 'E471')?.entry.status, 'syubhat');
check('E322 -> syubhat', matchTerm(index, 'E322')?.entry.status, 'syubhat');
check('大豆レシチン still halal', matchTerm(index, '大豆レシチン')?.entry.status, 'halal');

const ecoMap = new Map(ecodeEntries.map((e) => [e.eNumber, e.status]));
let statusConflicts = 0;
for (const e of curatedEntries) {
  if (e.eNumber && ecoMap.has(e.eNumber) && ecoMap.get(e.eNumber) !== e.status) statusConflicts++;
}
check('no curated/ecode status conflicts', statusConflicts, 0);

// 11. Layer 2: OFF vegan signal + ADDI provenance citation.
const veganHit = matchTerm(getCatalogIndex(), 'ココア');
check('OFF vegan signal -> halal', veganHit?.entry.status, 'halal');
check('OFF vegan basis origin-signal', veganHit?.entry.basis, 'origin-signal');
check('OFF vegan confidence low', veganHit?.entry.confidence, 'low');

const cited = loadCatalog().entries.filter((e) =>
  e.sources.some((s) => s.includes('ADDI ITS'))
);
check('ADDI citations attached to catalog', cited.length > 0, true);

// 12. Real label fixture (from an actual scan): section extraction + matching.
const REAL_LABEL = `うま塩ペッパーチキンバーガー*F1
¥378
消費期限 26.9.27 午前 3時
保存方法 10℃以下
(税込
ロレンジ加熱目安、
内容量 1個
500w 1分秒393kcal
1500w 0分20秒、
408.240
名称 讃理パン
原材料名 ロストチキン(タイ製造)、パン、マヨネー
ズ、玉葱、胡瓜酢漬、マスタード、黒胡椒、食塩、
レモン
果汁、にんにく、 白部被/調味料(有機酸等)、乳化
剤。
増古南(加工でん粉、増第多糖類)、酸味料、香平料、
酸Ca、 Ｖ、 Ｃ、 (一部に卵・乳成分・小麦・大豆・舞
を含む)
2053784100150
製造者プライムデリカ(株)豊田第二工場
栄養成分表示 1包装当り 熱量393kcal`;

const section = extractIngredientSection(REAL_LABEL);
check('section starts at ingredients', section.startsWith('ロストチキン'), true);
check('section excludes nutrition', section.includes('栄養成分'), false);
check('section excludes maker', section.includes('製造者'), false);
check('section excludes allergens', section.includes('を含む'), false);

const realScan = analyzeLayered(getCuratedIndex(), getCatalogIndex(), section);
const realById = new Map(
  realScan.filter((f) => f.match).map((f) => [f.normalized, f.match!])
);
const statusOf = (raw: string) => realById.get(normalize(raw))?.entry.status;
check('chicken via rule -> syubhat (JP slaughter)', statusOf('ロストチキン'), 'syubhat');
check('mayonnaise -> halal', statusOf('マヨネーズ'), 'halal');
check('garlic にんにく -> halal', statusOf('にんにく'), 'halal');
check('onion 玉葱 -> halal', statusOf('玉葱'), 'halal');
check('salt 食塩 -> halal', statusOf('食塩'), 'halal');
check('emulsifier 乳化剤 -> syubhat', statusOf('乳化剤'), 'syubhat');
check('modified starch 加工でん粉 -> syubhat', statusOf('加工でん粉'), 'syubhat');
check('real label matched >= 8', realScan.filter((f) => f.match).length >= 8, true);

// 13. OCR-error marker + label-noise filtering + frozen-food vocabulary.
const OCR_ERR = `名称 調理パン
所材料名 ロストチキン(タイ製造)、パン、マヨネーズ
税込 ¥378
栄養成分表示 393kcal`;
const sec2 = extractIngredientSection(OCR_ERR);
check('section found despite 所材料名', sec2.startsWith('ロストチキン'), true);
check('section stops before tax', sec2.includes('税込'), false);

check('noise: 税込', isLabelNoise(normalize('税込')), true);
check('noise: 栄養成分表示', isLabelNoise(normalize('栄養成分表示')), true);
check('noise: タイ製造', isLabelNoise(normalize('タイ製造')), true);
check('noise: を含む', isLabelNoise(normalize('を含む')), true);
check('noise: 内容量', isLabelNoise(normalize('内容量')), true);
check('not noise: 乳化剤', isLabelNoise(normalize('乳化剤')), false);

const frozenScan = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  '有機酸等、食物繊維、増幹占多糖類、黒胡線、香平料、マーガリン'
);
const fById = new Map(frozenScan.filter((f) => f.match).map((f) => [f.normalized, f.match!]));
const fs = (r: string) => fById.get(normalize(r))?.entry.status;
check('有機酸等 -> halal', fs('有機酸等'), 'halal');
check('食物繊維 -> halal', fs('食物繊維'), 'halal');
check('増幹占多糖類 -> halal', fs('増幹占多糖類'), 'halal');
check('黒胡線 -> halal', fs('黒胡線'), 'halal');
check('香平料 -> halal', fs('香平料'), 'halal');
check('マーガリン -> syubhat', fs('マーガリン'), 'syubhat');

// 14. OCR table-border injected mid-word + mineral/vitamin tokens.
const PIPE_LABEL = `名称調理パン
原材料名 ロストチキン(タイ製造)、パン、マヨネ
ー
|ズ、玉葱、食塩、酸Ca、V.C
2053784100150`;
const s4 = extractIngredientSection(PIPE_LABEL);
check('pipe-wrapped word rejoined', s4.includes('マヨネーズ'), true);
const pipeScan = analyzeLayered(getCuratedIndex(), getCatalogIndex(), s4);
const pById = new Map(pipeScan.filter((f) => f.match).map((f) => [f.normalized, f.match!]));
const ps = (r: string) => pById.get(normalize(r))?.entry.status;
check('マヨネーズ -> halal (rejoined)', ps('マヨネーズ'), 'halal');
check('酸Ca -> halal', ps('酸Ca'), 'halal');
check('V.C -> halal', ps('V.C'), 'halal');

// 15. Real-device regressions (from 3 on-device scans).
const OCR3 = `商品名クッキー
原材名 小麦粉、砂糖、久米田38-33
注意 置いてください
栄養成分表示 たんばく質0.6g`;
const s5 = extractIngredientSection(OCR3);
check('原材名 marker detected', s5.startsWith('小麦粉'), true);
check('section stops at 注意', s5.includes('注意'), false);

check('noise: 注意', isLabelNoise(normalize('注意')), true);
check('noise: 置いてください', isLabelNoise(normalize('置いてください')), true);
check('noise: ます', isLabelNoise(normalize('ます')), true);
check('not noise: 砂糖', isLabelNoise(normalize('砂糖')), false);

const r = analyzeLayered(getCuratedIndex(), getCatalogIndex(), '久米田38-33、香辛米斗、白米');
const rById = new Map(r.filter((f) => f.match).map((f) => [f.normalized, f.match!]));
check('address not rice', rById.get(normalize('久米田38-33'))?.entry.id, undefined);
check('香辛米斗 -> spices', rById.get(normalize('香辛米斗'))?.entry.id, 'rule:spice2');
check('白米 -> rice', rById.get(normalize('白米'))?.entry.id, 'rule:rice');

check('量120グ not an E-code', matchTerm(index, '量120グ'), null);

const dup = analyzeLayered(getCuratedIndex(), getCatalogIndex(), 'とモン、レモン果汁');
const dupIds = dup.filter((f) => f.match).map((f) => f.match!.entry.id);
check('とモン dropped as near-dup', dupIds.includes('catalog:lemon'), false);

// 16. Round-2 device regressions (4 scans): rule precision + noise + variants.
const g = analyzeLayered(getCuratedIndex(), getCatalogIndex(), '量120グラム');
check('グラム not lamb', g.some((f) => f.match?.entry.id === 'rule:lamb'), false);

const s6 = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  '添付醤油、水あめ、着色料、乳化剂'
);
const s6m = new Map(s6.filter((f) => f.match).map((f) => [f.normalized, f.match!]));
check('添付醤油 -> soy sauce syubhat', s6m.get(normalize('醤油'))?.entry.status, 'syubhat');
check('水あめ -> starch-syrup', s6m.get(normalize('水あめ'))?.entry.id, 'rule:starch-syrup');
check('着色料 -> coloring syubhat', s6m.get(normalize('着色料'))?.entry.status, 'syubhat');
check('乳化剂 -> emulsifier syubhat', s6m.get(normalize('乳化剂'))?.entry.status, 'syubhat');

check('noise: 外装', isLabelNoise(normalize('外装')), true);
check('noise: パッケージ', isLabelNoise(normalize('パッケージ')), true);
check('noise: 成分', isLabelNoise(normalize('成分')), true);
check('noise: 常温', isLabelNoise(normalize('常温')), true);

// 17. Round-3 device regressions: catalog fuzzy guard + OCR variants.
check('SoooN not matched to catalog', matchTerm(getCatalogIndex(), 'SoooN'), null);

const s7 = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  'pH調剤、膨服剤、沙糖、酱油'
);
const s7m = new Map(s7.filter((f) => f.match).map((f) => [f.normalized, f.match!]));
check('pH調剤 -> ph-adjuster', s7m.get(normalize('pH調剤'))?.entry.id, 'rule:ph-adjuster');
check('膨服剤 -> raising-agent', s7m.get(normalize('膨服剤'))?.entry.id, 'rule:raising-agent');
check('沙糖 -> sugar-variant', s7m.get(normalize('沙糖'))?.entry.id, 'rule:sugar-variant');
check('酱油 -> soy sauce syubhat', s7m.get(normalize('酱油'))?.entry.status, 'syubhat');

check('noise: 成分表示', isLabelNoise(normalize('成分表示')), true);
check('noise: 保存法', isLabelNoise(normalize('保存法')), true);
check('noise: タイ製造', isLabelNoise(normalize('タイ製造')), true);

// 18. Round-4 device regressions.
const OCR4 = `商品名クッキー
対料名 小麦粉、砂糖、食塩
時簡 10分
養成分表示 たんばく質`;
const s8 = extractIngredientSection(OCR4);
check('対料名 marker detected', s8.startsWith('小麦粉'), true);
check('section stops at 時簡', s8.includes('時簡'), false);

check('noise: 外袋', isLabelNoise(normalize('外袋')), true);
check('noise: 時簡', isLabelNoise(normalize('時簡')), true);
check('noise: 養成分', isLabelNoise(normalize('養成分')), true);

const s9 = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  'コハク酸二ナトリウム、ア三ノ酸等、调味料'
);
const s9m = new Map(s9.filter((f) => f.match).map((f) => [f.normalized, f.match!]));
check('コハク酸 -> succinate', s9m.get(normalize('コハク酸二ナトリウム'))?.entry.id, 'rule:succinate');
check('ア三ノ酸 -> amino-acid', s9m.get(normalize('ア三ノ酸等'))?.entry.id, 'rule:amino-acid');
check('调味料 -> seasoning', s9m.get(normalize('调味料'))?.entry.id, 'rule:seasoning');

// 19. v1 cleanup: structural address/unit filter + newly labelled ingredients.
check('noise: address Osaka', isLabelNoise(normalize('大阪府大阪市生野区林寺6-7-22')), true);
check('noise: address Gifu', isLabelNoise(normalize('岐阜県大垣市川口4-869-2')), true);
check('noise: phone', isLabelNoise(normalize('0120-110-249')), true);
check('noise: measurement', isLabelNoise(normalize('糖質24.6g食物裁')), true);
check('noise: grams', isLabelNoise(normalize('量120グラム')), true);
check('E1200 still kept', isLabelNoise(normalize('E1200')), false);
check('not noise: 乳化剤', isLabelNoise(normalize('乳化剤')), false);

const s10 = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  'シャロット、スターアニス、チリパウダ、なたね油、カレー粉、チャツネ、二酸化ケイ素'
);
const s10m = new Map(s10.filter((f) => f.match).map((f) => [f.normalized, f.match!]));
check('シャロット -> shallot', s10m.get(normalize('シャロット'))?.entry.id, 'rule:shallot');
check('スターアニス -> star-anise', s10m.get(normalize('スターアニス'))?.entry.id, 'rule:star-anise');
check('チリパウダ -> chili-powder', s10m.get(normalize('チリパウダ'))?.entry.id, 'rule:chili-powder');
check('なたね油 -> rapeseed-oil', s10m.get(normalize('なたね油'))?.entry.id, 'rule:rapeseed-oil');
check('カレー粉 -> curry-powder', s10m.get(normalize('カレー粉'))?.entry.id, 'rule:curry-powder');
check('チャツネ -> chutney', s10m.get(normalize('チャツネ'))?.entry.id, 'rule:chutney');
check('二酸化ケイ素 -> silica', s10m.get(normalize('二酸化ケイ素'))?.entry.id, 'rule:silica');

// 20. Frequency-ranked labeling: safety rules + coverage batch.
const s11 = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  'ベーコン、焼酎、洋酒、海苔、グリシン、キサンタン、オリーブ油、ベニコウジ色素'
);
const s11m = new Map(s11.filter((f) => f.match).map((f) => [f.normalized, f.match!]));
check('ベーコン -> haram', s11m.get(normalize('ベーコン'))?.entry.status, 'haram');
check('焼酎 -> haram', s11m.get(normalize('焼酎'))?.entry.status, 'haram');
check('洋酒 -> haram', s11m.get(normalize('洋酒'))?.entry.status, 'haram');
check('海苔 -> halal', s11m.get(normalize('海苔'))?.entry.status, 'halal');
check('グリシン -> halal', s11m.get(normalize('グリシン'))?.entry.status, 'halal');
check('キサンタン -> halal', s11m.get(normalize('キサンタン'))?.entry.status, 'halal');
check('オリーブ油 -> halal', s11m.get(normalize('オリーブ油'))?.entry.status, 'halal');
check('ベニコウジ色素 -> halal', s11m.get(normalize('ベニコウジ色素'))?.entry.status, 'halal');

// 21. Phase 1: ingredient-region crop from ML Kit line frames (pure logic).
const fakeResult = {
  text: '',
  blocks: [
    {
      text: '',
      lines: [
        { text: '商品名ハンバーガー', frame: { top: 40, left: 0, width: 300, height: 30 } },
        { text: '原材料名 ロストチキン、パン', frame: { top: 100, left: 0, width: 500, height: 40 } },
        { text: '砂糖、食塩', frame: { top: 150, left: 0, width: 300, height: 40 } },
        { text: '乳化剤', frame: { top: 200, left: 0, width: 200, height: 40 } },
        { text: '栄養成分表示', frame: { top: 260, left: 0, width: 300, height: 40 } },
      ],
    },
  ],
} as any;

const crop = computeIngredientCrop(fakeResult, 1000, 2000);
check('crop found', !!crop, true);
check('crop starts at header', crop?.rect.originY, 76);
check('crop stops before boundary', crop?.boundaryText, '栄養成分表示');
check('crop line count', crop?.lines, 3);
check('crop bottom excludes boundary', crop?.rect.height, 188);
check('crop width full', crop?.rect.width, 940);

const noHeader = { text: '', blocks: [{ text: '', lines: [{ text: 'こんにちは', frame: { top: 10, left: 0, width: 50, height: 20 } }] }] } as any;
check('crop null when no header', computeIngredientCrop(noHeader, 1000, 2000), null);

// Regression: a nutrition word appearing MID-LINE in an ingredient must not end the crop.
check('crop boundary ignores mid-line たんぱく質', isCropBoundary('調味料(砂糖、植物性たんぱく質'), false);
check('crop boundary matches line-start marker', isCropBoundary('栄養成分表示 100g当り'), true);

const midLine = {
  text: '',
  blocks: [
    {
      text: '',
      lines: [
        { text: '原材料名 揚げめん(小麦粉)', frame: { top: 100, left: 0, width: 500, height: 40 } },
        { text: '調味料(砂糖、植物性たんぱく質)', frame: { top: 150, left: 0, width: 500, height: 40 } },
        { text: '栄養成分表示 100g当り', frame: { top: 200, left: 0, width: 400, height: 40 } },
      ],
    },
  ],
} as any;
const midCrop = computeIngredientCrop(midLine, 1000, 2000);
check('crop keeps ingredient line with たんぱく質', midCrop?.rect.height, 138);
check('crop stops at real boundary', midCrop?.boundaryText, '栄養成分表示 100g当り');

// 22. Truncated-first-char OCR variants (seen after hybrid crop passes).
const s12 = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  'エン酸、ラメル、かんす、んにく、ピタ三ンB2'
);
const s12m = new Map(s12.filter((f) => f.match).map((f) => [f.normalized, f.match!]));
check('エン酸 -> citric', s12m.get(normalize('エン酸'))?.entry.id, 'rule:citric');
check('ラメル -> caramel', s12m.get(normalize('ラメル'))?.entry.id, 'rule:caramel');
check('かんす -> kansui', s12m.get(normalize('かんす'))?.entry.id, 'rule:kansui');
check('んにく -> garlic', s12m.get(normalize('んにく'))?.entry.id, 'rule:garlic');
check('ピタ三ンB2 -> vitamin', s12m.get(normalize('ピタ三ンB2'))?.entry.id, 'rule:vitamin');
check('noise: たんはく質', isLabelNoise(normalize('たんはく質')), true);

// 23. Coordinate mapping for the downscale-then-crop flow.
check(
  'scaleRect maps back to original',
  JSON.stringify(scaleRect({ originX: 10, originY: 20, width: 100, height: 50 }, 0.5)),
  JSON.stringify({ originX: 5, originY: 10, width: 50, height: 25 })
);
check(
  'clampRect keeps rect inside image',
  JSON.stringify(clampRect({ originX: -5, originY: 10, width: 1000, height: 50 }, 100, 200)),
  JSON.stringify({ originX: 0, originY: 10, width: 100, height: 50 })
);

// 24. Phase 2: confusion map (variant fold + weighted edit distance).
check('fold 剂 -> 剤', normalize('酸化防止剂'), '酸化防止剤');
check('fold 酱 -> 醤', normalize('酱油'), '醤油');
check('fold 类 -> 類', normalize('多糖类'), '多糖類');
check('fold 增 -> 増', normalize('増粘剤'), '増粘剤');

check('cost ズ/ス cheap', substitutionCost('ズ', 'ス') < 0.5, true);
check('cost カ/力 cheap', substitutionCost('カ', '力') < 0.5, true);
check('cost ミ/三 cheap', substitutionCost('ミ', '三') < 0.5, true);
check('cost ョ/ヨ cheap', substitutionCost('ョ', 'ヨ') < 0.5, true);

let forbiddenCheap = 0;
for (const [a, b] of FORBIDDEN_CHEAP_PAIRS) {
  if (substitutionCost(a, b) < 1) forbiddenCheap++;
}
check('forbidden pairs stay expensive', forbiddenCheap, 0);

// 24b. Published Japanese OCR confusion sets (SHOMEI Tier K): the classic kana
// misreads シ/ツ, ソ/ン, は/ほ must be cheap for the fuzzy matcher, but must not
// weaken the high-stakes safety set (re-asserted here so the new pairs are
// covered by the invariant, not just by the earlier loop).
check('cost シ/ツ cheap (published kana confusion)', substitutionCost('シ', 'ツ') < 0.5, true);
check('cost ソ/ン cheap (published kana confusion)', substitutionCost('ソ', 'ン') < 0.5, true);
check('cost は/ほ cheap (published kana confusion)', substitutionCost('は', 'ほ') < 0.5, true);
let kanaForbiddenCheap = 0;
for (const [a, b] of FORBIDDEN_CHEAP_PAIRS) {
  if (substitutionCost(a, b) < 1) kanaForbiddenCheap++;
}
check('high-stakes pairs still expensive after kana additions', kanaForbiddenCheap, 0);

const wSim = weightedSimilarity('マヨネース', 'マヨネーズ', substitutionCost);
const uSim = similarity('マヨネース', 'マヨネーズ');
check('weighted similarity boosts kana pair', wSim > uSim, true);
check('weighted similarity high', wSim > 0.9, true);

// Variant fold reaches the matcher: 酸化防止剂 (Chinese 剂) -> 酸化防止剤 rule.
const foldScan = analyzeLayered(getCuratedIndex(), getCatalogIndex(), '酸化防止剂');
check(
  'matcher folds 剤 -> antioxidant',
  foldScan.find((f) => f.match)?.match?.entry.id,
  'rule:antioxidant'
);

// 25. Round-6 device regressions: more confusion pairs + variant patterns.
check('cost 汁/计 cheap', substitutionCost('汁', '计') < 0.5, true);
check('cost 香/看 cheap', substitutionCost('香', '看') < 0.5, true);

// Rules are substring-based, so they bypass the <=2-char exact-only gate that
// protects 豚肉/牛肉 — these truncated forms are reachable that way.
const s13 = analyzeLayered(getCuratedIndex(), getCatalogIndex(), '黒胡、ミンE');
const s13m = new Map(s13.filter((f) => f.match).map((f) => [f.normalized, f.match!]));
check('黒胡 -> pepper', s13m.get(normalize('黒胡'))?.entry.id, 'rule:pepper2');
check('ミンE -> vitamin', s13m.get(normalize('ミンE'))?.entry.id, 'rule:vitamin');

// 26. Round-7: truncated/variant rule patterns + extra label noise.
const s14 = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  'ア三、微粒二酸化イ素、酸化防、色料、即席、調味油、看料、果计'
);
const s14m = new Map(s14.filter((f) => f.match).map((f) => [f.normalized, f.match!]));
check('ア三 -> amino-acid', s14m.get(normalize('ア三'))?.entry.id, 'rule:amino-acid');
check('微粒二酸化イ素 -> silica', s14m.get(normalize('微粒二酸化イ素'))?.entry.id, 'rule:silica');
check('酸化防 -> antioxidant', s14m.get(normalize('酸化防'))?.entry.id, 'rule:antioxidant');
check('色料 -> coloring', s14m.get(normalize('色料'))?.entry.status, 'syubhat');
check('即席 -> noodle', s14m.get(normalize('即席'))?.entry.id, 'rule:noodle');
check('調味油 -> seasoning', s14m.get(normalize('調味油'))?.entry.id, 'rule:seasoning');
check('看料 -> flavoring', s14m.get(normalize('看料'))?.entry.status, 'syubhat');
check('果计 -> fruit-juice', s14m.get(normalize('果计'))?.entry.id, 'rule:fruit-juice');

for (const noise of ['灰水化物', 'はく質', '熟量', '表示', '相当量', '品質', '材名']) {
  check(`noise: ${noise}`, isLabelNoise(normalize(noise)), true);
}

// 27. Round-8: long-vowel and dropped-n variants.
const s15 = analyzeLayered(getCuratedIndex(), getCatalogIndex(), 'パ一ム油、レモグラス');
const s15m = new Map(s15.filter((f) => f.match).map((f) => [f.normalized, f.match!]));
check('パ一ム油 -> palm-oil', s15m.get(normalize('パ一ム油'))?.entry.id, 'rule:palm-oil');
check('レモグラス -> lemon', s15m.get(normalize('レモグラス'))?.entry.id, 'rule:lemon');

// 28. Palm-oil with a stray character in the middle (パたーム油).
const s16 = analyzeLayered(getCuratedIndex(), getCatalogIndex(), 'パたーム油');
check(
  'パたーム油 -> palm-oil',
  s16.find((f) => f.match)?.match?.entry.id,
  'rule:palm-oil'
);

// 29. Audit fixes: storage/origin noise, Chinese 浆 fold, HFCS + unlabelled foods.
for (const noise of [
  '要冷蔵', '要冷凍', '殺菌', '風味原料', 'かやく', 'ガーナ', 'メキシコ',
  'ブラジル', 'ベトナム', 'インド', 'タイ産', '北海道', 'g当たり', '当たり',
]) {
  check(`noise: ${noise}`, isLabelNoise(normalize(noise)), true);
}
// Substring safety: 殺菌 must NOT drop 殺菌液卵 (sterilised liquid egg).
check('not noise: 殺菌液卵', isLabelNoise(normalize('殺菌液卵')), false);
check('殺菌液卵 still gets a verdict', analyzeLayered(getCuratedIndex(), getCatalogIndex(), '殺菌液卵').find((f) => f.match)?.match?.entry.status, 'halal');
for (const keep of ['調味料', '香辛料', '味噌', '醤油']) {
  check(`not noise: ${keep}`, isLabelNoise(normalize(keep)), false);
}

check('fold 浆 -> 漿', normalize('果葡糖浆'), '果葡糖漿');

const s17 = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  '果葡糖浆、パイナップル、バジル、シナモン、なす、そば、いくら、たらこ'
);
const s17m = new Map(s17.filter((f) => f.match).map((f) => [f.normalized, f.match!]));
check('果葡糖浆 (HFCS) -> halal', s17m.get(normalize('果葡糖浆'))?.entry.status, 'halal');
const newFoods: [string, string][] = [
  ['パイナップル', 'halal'],
  ['バジル', 'halal'],
  ['シナモン', 'halal'],
  ['なす', 'halal'],
  ['そば', 'halal'],
  ['いくら', 'halal'],
  ['たらこ', 'halal'],
];
for (const [raw, status] of newFoods) {
  check(`${raw} -> ${status}`, s17m.get(normalize(raw))?.entry.status, status);
}

// 30. Backlog round: safety-critical negative rules + high-frequency coverage.
const verdict30 = (raw: string) => {
  const f = analyzeLayered(getCuratedIndex(), getCatalogIndex(), raw).find((x) => x.match);
  return { status: f?.match?.entry.status, id: f?.match?.entry.id };
};
const SAFETY30: [string, string][] = [
  ['チャーシュー', 'haram'],
  ['ハム', 'haram'],
  ['豚ばら肉', 'haram'],
  ['スピリッツ', 'haram'],
  ['粉末酒', 'haram'],
  ['調味動物油脂', 'syubhat'],
  ['油脂', 'syubhat'],
  ['フォンドボー', 'syubhat'],
  ['ガムベース', 'syubhat'],
  ['乳化油脂', 'syubhat'],
  ['牛舌', 'syubhat'],
  ['植物油脂', 'halal'], // critical non-regression
  ['加工油脂', 'syubhat'],
];
for (const [raw, status] of SAFETY30) {
  check(`${raw} -> ${status}`, verdict30(raw).status, status);
}
for (const raw of ['糖蜜', '米油', 'モナカ', '無脂乳固形分', 'もやし', 'パパイヤ', 'ブラックペッパー']) {
  check(`${raw} -> halal`, verdict30(raw).status, 'halal');
}
check('乳化剤 still resolves to emulsifier', verdict30('乳化剤').id, 'emulsifier');

check('noise: カナダ', isLabelNoise(normalize('カナダ')), true);
check('noise: チリ', isLabelNoise(normalize('チリ')), true);
check('noise: イタリア', isLabelNoise(normalize('イタリア')), true);
check('not noise: チリパウダ', isLabelNoise(normalize('チリパウダ')), false);

// 31. Audit round 2: order-lock regression + Simplified-Chinese cluster + noise.
const ORDER_LOCK: [string, string][] = [
  ['植物油脂', 'halal'],
  ['食用植物油脂', 'halal'],
  ['油脂', 'syubhat'],
  ['加工油脂', 'syubhat'],
];
for (const [raw, status] of ORDER_LOCK) {
  check(`[order-lock] ${raw} -> ${status}`, verdict30(raw).status, status);
}

const CN_CLUSTER: [string, string][] = [
  ['味精', 'halal'],
  ['精炼棕桐油', 'halal'],
  ['全脂乳粉', 'halal'],
  ['加糖れん乳', 'halal'],
  ['丙酸钙', 'halal'],
  ['单双甘油脂肪酸酯', 'syubhat'],
  ['山梨糖醇', 'syubhat'],
  ['脱氢乙酸钠', 'syubhat'],
  ['食用香精', 'syubhat'],
  ['たん白水分解物', 'syubhat'],
  ['たん白自己消化物', 'syubhat'],
];
for (const [raw, status] of CN_CLUSTER) {
  check(`${raw} -> ${status}`, verdict30(raw).status, status);
}

check('noise: 添加量', isLabelNoise(normalize('添加量')), true);
check('noise: 気密性容器', isLabelNoise(normalize('気密性容器')), true);
check('not noise: 保存料', isLabelNoise(normalize('保存料')), false);

// 32. Verifier round: order/safety rules + hydrolyzed protein + negative-claim
// noise + small vocabulary gaps. Safety-first ordering regressions.
const FIX32: [string, string][] = [
  ['動植物油脂', 'syubhat'],
  ['動植物油', 'syubhat'],
  ['動物油脂', 'syubhat'],
  ['植物油脂', 'halal'],
  ['食用植物油脂', 'halal'],
  ['油脂', 'syubhat'],
  ['加水分解酵母', 'halal'],
  ['蛋白加水分解物', 'syubhat'],
  ['卵白加水分解物', 'syubhat'],
  ['たんぱく質加水分解物', 'syubhat'],
  ['デヒドロ酢酸', 'syubhat'],
  ['デヒドロ酢酸Na', 'syubhat'],
  ['ハム', 'haram'],
  ['ロースハム', 'haram'],
  ['ハム玉葱入りドレッシング', 'haram'],
  ['卵磷脂', 'syubhat'],
  ['大豆レシチン', 'halal'],
  ['タラコ', 'halal'],
  ['イクラ', 'halal'],
  ['グルタミン酸Na', 'halal'],
  ['糖アルコール', 'halal'],
];
for (const [raw, status] of FIX32) {
  check(`[fix32] ${raw} -> ${status}`, verdict30(raw).status, status);
}
check('[fix32] ハムスター NOT haram', verdict30('ハムスター').status !== 'haram', true);
check('[fix32] ハムレット NOT haram', verdict30('ハムレット').status !== 'haram', true);
check('[fix32] animal-plant-fat rule id', verdict30('動植物油脂').id, 'rule:animal-plant-fat');
check('[fix32] hydrolyzed-protein rule id', verdict30('蛋白加水分解物').id, 'rule:hydrolyzed-protein');
check('[fix32] hydrolyzed-yeast rule id', verdict30('加水分解酵母').id, 'rule:hydrolyzed-yeast');
check('[fix32] dehydroacetic rule id', verdict30('デヒドロ酢酸').id, 'rule:dehydroacetic-acid');
check('[fix32] ham rule id', verdict30('ハム').id, 'rule:ham');
check('[fix32] bare たんぱく質 is noise', isLabelNoise(normalize('たんぱく質')), true);

for (const claim of ['乳化剤不使用', '無添加乳化剤']) {
  check(`[fix32] noise: ${claim}`, isLabelNoise(normalize(claim)), true);
}
for (const keep of ['乳化剤', '香料', '着色料']) {
  check(`[fix32] not noise: ${keep}`, isLabelNoise(normalize(keep)), false);
}

// 33. Verifier round 2: ham substring forms, graham, 蛋/蛋白 fold removal,
// animal/plant fat wording, glutamate curation, hydrolyzed yeast, freeze-dried.
const FIX33: [string, string][] = [
  ['ハムスライス', 'haram'],
  ['ハムステーキ', 'haram'],
  ['生ハム', 'haram'],
  ['グラハム', 'halal'],
  ['蛋白加水分解物', 'syubhat'],
  ['動植物性油脂', 'syubhat'],
  ['グルタミン酸', 'halal'],
  ['グルタミン酸Na', 'halal'],
  ['酵母加水分解物', 'halal'],
  ['植物油脂', 'halal'], // non-regression
  ['ハム', 'haram'], // non-regression
  ['糖アルコール', 'halal'], // non-regression
];
for (const [raw, status] of FIX33) {
  check(`[fix33] ${raw} -> ${status}`, verdict30(raw).status, status);
}
check('[fix33] ハムスター NOT haram', verdict30('ハムスター').status !== 'haram', true);
check('[fix33] 動植物蛋白 NOT halal', verdict30('動植物蛋白').status !== 'halal', true);
check('[fix33] 蛋白質 NOT halal', verdict30('蛋白質').status !== 'halal', true);
check('[fix33] グルタミン酸 curated id', verdict30('グルタミン酸').id, 'glutamate');
check('[fix33] 酵母加水分解物 rule id', verdict30('酵母加水分解物').id, 'rule:hydrolyzed-yeast');
check('[fix33] フリーズドライ NOT noise', isLabelNoise(normalize('フリーズドライ')), false);
check('[fix33] noise: カフェインフリー', isLabelNoise(normalize('カフェインフリー')), true);
check('[fix33] noise: グルテンフリー', isLabelNoise(normalize('グルテンフリー')), true);
check('[fix33] noise: 糖類フリー', isLabelNoise(normalize('糖類フリー')), true);

// 34. Safety invariant: fuzzy matching can never yield haram; widened ham
// lookahead; フリー anchored at token end; Chinese protein/egg coverage.
const notHaram = (raw: string) => {
  const f = analyzeLayered(getCuratedIndex(), getCatalogIndex(), raw).find((x) => x.match);
  return f?.match?.entry.status !== 'haram';
};

// The 7 plant/fish extracts that used to fuzzy-match 豚肉エキス/豚エキス (haram).
for (const raw of [
  '麦芽エキス',
  '昆布エキス',
  '野菜エキス',
  '紅茶エキス',
  '鰹エキス',
  'えびエキス',
  'かにエキス',
]) {
  check(`[fix34] ${raw} NOT haram (fuzzy invariant)`, notHaram(raw), true);
}

// Exact pork extracts must STILL be haram (exact match, not fuzzy).
for (const raw of ['豚肉エキス', '豚エキス', 'ポークエキス']) {
  check(`[fix34] ${raw} -> haram (exact)`, verdict30(raw).status, 'haram');
}

// Core haram exact/rule matches must not regress.
for (const raw of ['豚肉', 'ベーコン', 'チャーシュー', 'ハム', '焼酎', 'スピリッツ']) {
  check(`[fix34] ${raw} -> haram`, verdict30(raw).status, 'haram');
}

// Widened ham lookahead: real ham still haram…
for (const raw of ['ハム', 'ハムカツ', 'ロースハム', 'ハムスライス', 'ハムステーキ', 'ハムサンド', 'ハムサラダ']) {
  check(`[fix34] ${raw} -> haram`, verdict30(raw).status, 'haram');
}
// …but non-pork words containing ハム are not.
for (const raw of ['アブラハム', 'ハムザ', 'ハムラビ', 'ハムサ', 'ハムスター']) {
  check(`[fix34] ${raw} NOT haram`, notHaram(raw), true);
}

// フリー must be anchored at the END: genuine claims stay noise…
for (const claim of [
  'カフェインフリー',
  'グルテンフリー',
  '糖類フリー',
  '添加物フリー',
  'アルコールフリー',
]) {
  check(`[fix34] noise: ${claim}`, isLabelNoise(normalize(claim)), true);
}
// …while real words that merely start/contain フリー are kept.
for (const keep of ['フリーレンジ卵', 'フリーカット', 'フリーズドライ']) {
  check(`[fix34] not noise: ${keep}`, isLabelNoise(normalize(keep)), false);
}

// Chinese protein + traditional egg forms.
const PROTEIN34: [string, string][] = [
  ['植物蛋白', 'halal'],
  ['植物性蛋白', 'halal'],
  ['動物蛋白', 'syubhat'],
  ['動物性蛋白', 'syubhat'],
  ['動植物蛋白', 'syubhat'],
  ['雞蛋', 'halal'],
  ['雞卵', 'halal'],
];
for (const [raw, status] of PROTEIN34) {
  check(`[fix34] ${raw} -> ${status}`, verdict30(raw).status, status);
}

// 35. Safety round: restored wine verdicts + latent haram gaps (exact rules /
// curated exact). Wine must stay exact so ワイン酢 (wine vinegar, halal) is not
// caught; ラム酒 must not be a broad /ラム/ (lamb/グラム).
const FIX35: [string, string][] = [
  ['赤ワイン', 'haram'],
  ['白ワイン', 'haram'],
  ['ワイン', 'haram'],
  ['ラム酒', 'haram'],
  ['甘味果実酒', 'haram'],
  ['米酒', 'haram'],
  ['白酒', 'haram'],
  ['豚生姜焼', 'haram'],
  ['豚コラーゲン', 'haram'],
  ['豚肉', 'haram'], // non-regression
];
for (const [raw, status] of FIX35) {
  check(`[fix35] ${raw} -> ${status}`, verdict30(raw).status, status);
}
// Negative / non-regression: plant+fish extracts must never be haram.
for (const raw of ['ワイン酢', 'ぶどう', 'ぶどう酢', '麦芽エキス', '昆布エキス']) {
  check(`[fix35] ${raw} NOT haram`, notHaram(raw), true);
}
check('[fix35] 赤ワイン curated wine id', verdict30('赤ワイン').id, 'wine');
check('[fix35] ワイン still curated wine id', verdict30('ワイン').id, 'wine');
check('[fix35] 豚コラーゲン curated pork id', verdict30('豚コラーゲン').id, 'pork');
check('[fix35] ラム酒 rule id', verdict30('ラム酒').id, 'rule:rum');
check('[fix35] 甘味果実酒 rule id', verdict30('甘味果実酒').id, 'rule:sweet-fruit-wine');
check('[fix35] 米酒 rule id', verdict30('米酒').id, 'rule:rice-wine');
check('[fix35] 白酒 rule id', verdict30('白酒').id, 'rule:baijiu');
check('[fix35] 豚生姜焼 rule id', verdict30('豚生姜焼').id, 'rule:pork');

// 36. Final audit round: alcohol correctness (fruit wine, sparkling/varietal
// wine, beer/spirits vocabulary), margarine/butter shadowing, chicken-frame
// extracts, and the fuzzy-curated-vs-rule ordering fix.
const FIX36: [string, string][] = [
  ['果実酒', 'haram'],
  ['果実酒類', 'haram'],
  ['セパージュワイン', 'haram'],
  ['スパークリングワイン', 'haram'],
  ['ビール', 'haram'],
  ['発泡酒', 'haram'],
  ['ウォッカ', 'haram'],
  ['ブランデー', 'haram'],
  ['甘酒', 'syubhat'],
  ['バター入りマーガリン', 'syubhat'],
  ['麦芽エキス', 'halal'],
  ['昆布エキス', 'halal'],
  ['鰹エキス', 'halal'],
  ['紅茶エキス', 'halal'],
  ['ワイン', 'haram'], // non-regression
  ['豚肉エキス', 'haram'], // non-regression
  ['麦芽', 'halal'], // non-regression
];
for (const [raw, status] of FIX36) {
  check(`[fix36] ${raw} -> ${status}`, verdict30(raw).status, status);
}
check(
  '[fix36] 鶏がらスープパウダー NOT halal',
  verdict30('鶏がらスープパウダー').status !== 'halal',
  true
);
check('[fix36] 野菜エキス NOT haram', notHaram('野菜エキス'), true);
check('[fix36] ワイン酢 NOT haram', notHaram('ワイン酢'), true);
check('[fix36] ぶどう NOT haram', notHaram('ぶどう'), true);
check('[fix36] ビール rule id', verdict30('ビール').id, 'rule:beer');
check('[fix36] 甘酒 rule id', verdict30('甘酒').id, 'rule:amazake');
check('[fix36] 果実酒 rule id', verdict30('果実酒').id, 'rule:sweet-fruit-wine');
check('[fix36] セパージュワイン curated wine id', verdict30('セパージュワイン').id, 'wine');
check('[fix36] 麦芽エキス rule id', verdict30('麦芽エキス').id, 'rule:malt');

// 37. Independent-verification fixes: cocktail-sauce/dressing false haram,
// fermented/flavoured-seasoning syubhat recovery, chicken/meat fat gaps, and
// cheese powder.
check('カクテル -> haram', verdict30('カクテル').status, 'haram');
check('カクテルソース NOT haram', notHaram('カクテルソース'), true);
check('カクテルドレッシング NOT haram', notHaram('カクテルドレッシング'), true);
check('[fix37] カクテル rule id', verdict30('カクテル').id, 'rule:beer');
check('[fix37] カクテルソース -> sauce syubhat', verdict30('カクテルソース').status, 'syubhat');
check('[fix37] カクテルドレッシング -> dressing syubhat', verdict30('カクテルドレッシング').status, 'syubhat');

const FERMENTED37: [string, string][] = [
  ['醸造調味料', 'syubhat'],
  ['発酵調味料', 'syubhat'],
  ['醗酵調味料', 'syubhat'],
  ['はっ酵調味料', 'syubhat'],
  ['米発酵調味料', 'syubhat'],
  ['発酵風味料', 'syubhat'],
  ['香味調味料', 'syubhat'],
  ['風味調味料', 'syubhat'],
  ['液体調味料', 'syubhat'],
];
for (const [raw, status] of FERMENTED37) {
  check(`[fix37] ${raw} -> ${status}`, verdict30(raw).status, status);
}
check('[fix37] 調味料 -> halal', verdict30('調味料').status, 'halal');
check('[fix37] 醸造調味料 rule id', verdict30('醸造調味料').id, 'rule:fermented-seasoning');
check('[fix37] 液体調味料 rule id', verdict30('液体調味料').id, 'rule:fermented-seasoning');

check('[fix37] 蒸し鶏 -> syubhat', verdict30('蒸し鶏').status, 'syubhat');
check('[fix37] 鶏脂 -> syubhat', verdict30('鶏脂').status, 'syubhat');
check('[fix37] 食肉 NOT halal', verdict30('食肉').status !== 'halal', true);
check('[fix37] 食肉 -> syubhat', verdict30('食肉').status, 'syubhat');
check('[fix37] チーズパウダー -> syubhat', verdict30('チーズパウダー').status, 'syubhat');
check('[fix37] チーズパウダー rule id', verdict30('チーズパウダー').id, 'rule:cheese-powder');

// Non-regressions.
check('[fix37] ビール -> haram', verdict30('ビール').status, 'haram');
check('[fix37] 酵母エキス -> halal', verdict30('酵母エキス').status, 'halal');
check('[fix37] 麦芽エキス -> halal', verdict30('麦芽エキス').status, 'halal');
check('[fix37] 豚肉エキス -> haram', verdict30('豚肉エキス').status, 'haram');

// 38. Bulk label expansion (scripts/expand-labels.mjs). Representative sample
// from the ~877 generated curated entries + the safety non-regressions.
const EXP_PLANT: [string, string][] = [
  ['たけのこ', 'halal'],
  ['たけのこ水煮', 'halal'],
  ['れんこん', 'halal'],
  ['ほうれんそう', 'halal'],
  ['しそ', 'halal'],
  ['みかん', 'halal'], // was fuzzy→みりん(syubhat) before the exact entry
  ['ビート', 'halal'], // was fuzzy→ビーフ(syubhat) before the exact entry
  ['モロヘイヤ', 'halal'],
  ['カレーリーフ', 'halal'],
];
for (const [raw, status] of EXP_PLANT) {
  check(`[exp38] ${raw} -> ${status}`, verdict30(raw).status, status);
}
const EXP_LEGUME: [string, string][] = [
  ['ひよこ豆', 'halal'],
  ['白いんげん豆', 'halal'],
  ['枝豆', 'halal'],
  ['豆乳', 'halal'],
  ['おから', 'halal'],
  ['つぶあん', 'halal'],
  ['白あん', 'halal'],
];
for (const [raw, status] of EXP_LEGUME) {
  check(`[exp38] ${raw} -> ${status}`, verdict30(raw).status, status);
}
for (const raw of ['グレープフルーツ', 'デーツ', 'キウイフルーツ', 'ゆず']) {
  check(`[exp38] ${raw} -> halal (fruit)`, verdict30(raw).status, 'halal');
}
for (const raw of ['上新粉', 'オーツ粉', '蕎麦の実', 'パスタ', 'おむすび', 'もなか']) {
  check(`[exp38] ${raw} -> halal (grain)`, verdict30(raw).status, 'halal');
}
for (const raw of ['マグロ', 'いわし', 'さんま', 'ほたて', 'あさり', '明太子', 'しらす', 'かまぼこ', '焼きあご']) {
  check(`[exp38] ${raw} -> halal (sea)`, verdict30(raw).status, 'halal');
}
for (const raw of ['岩塩', '焼成Ca', 'にがり', '二酸化炭素', '海洋深層水', '硫酸カルシウム', 'カルシウム', 'グルコン酸鉄']) {
  check(`[exp38] ${raw} -> halal (mineral)`, verdict30(raw).status, 'halal');
}
for (const raw of ['アラニン', 'エリスリトール', 'プルラン', 'ジェランガム', '結晶セルロース', 'スクロース', 'カルナウバロウ', 'アラビアゴム', 'ヒドロキシプロピルセルロース']) {
  check(`[exp38] ${raw} -> halal (additive)`, verdict30(raw).status, 'halal');
}
for (const raw of ['米酢', '黒糖', '三温糖', '食鹽']) {
  check(`[exp38] ${raw} -> halal (sugar/vinegar/salt)`, verdict30(raw).status, 'halal');
}
// Source-dependent classes and animal-derived terms stay syubhat.
const EXP_SYUBHAT: [string, string][] = [
  ['保湿剤', 'syubhat'],
  ['結着材料', 'syubhat'],
  ['ソルビタン', 'syubhat'],
  ['プロピレングリコール', 'syubhat'],
  ['つなぎ', 'syubhat'], // exact entry prevents fuzzy→うなぎ(halal)
  ['ラック', 'syubhat'],
  ['ローヤルゼリー', 'syubhat'],
  ['ランチョンミート', 'syubhat'],
  ['ソーセージ', 'syubhat'],
  ['ハンバーグ', 'syubhat'],
  ['牛挽肉', 'syubhat'],
  ['鶏油', 'syubhat'],
  ['フォンドヴォー', 'syubhat'],
  ['チーズ加工品', 'syubhat'],
  ['シュレッドチーズ', 'syubhat'],
  ['パルメザンチーズ', 'syubhat'],
  ['つゆ', 'syubhat'],
  ['カレールー', 'syubhat'],
  ['調味液', 'syubhat'],
  ['調味粉', 'syubhat'],
  ['粉末しょう油', 'syubhat'],
  ['中華だし', 'syubhat'],
  ['粉末ブイヨン', 'syubhat'],
  ['梅酢', 'syubhat'],
  ['デコレーションホイップ', 'syubhat'],
  ['植脂末', 'syubhat'],
];
for (const [raw, status] of EXP_SYUBHAT) {
  check(`[exp38] ${raw} -> ${status}`, verdict30(raw).status, status);
}
// Explicit haram (never from a heuristic).
for (const raw of ['紹興酒', 'ウオッカ', '味付豚挽肉', '豚タントリミング']) {
  check(`[exp38] ${raw} -> haram`, verdict30(raw).status, 'haram');
}
// Chinese additive names mapped to their Japanese-rule equivalent.
for (const raw of ['三氯蔗糖', '安赛蜜', '山梨酸钾', '二氧化硅', '碳酸钙', '黄原胶', '焦糖色素', '栀子黄']) {
  check(`[exp38] CN ${raw} -> halal`, verdict30(raw).status, 'halal');
}
// Names added to existing entries.
check('[exp38] ミリン -> syubhat (mirin entry)', verdict30('ミリン').status, 'syubhat');
check('[exp38] 酵母工キス -> halal (yeast-extract entry)', verdict30('酵母工キス').status, 'halal');
check('[exp38] ボークエキの -> haram (pork-extract entry)', verdict30('ボークエキの').status, 'haram');
check('[exp38] たけのこ uses generated id', (verdict30('たけのこ').id ?? '').startsWith('exp:'), true);

// Critical non-regressions (must never move).
check('[exp38] non-reg: 植物油脂 -> halal', verdict30('植物油脂').status, 'halal');
check('[exp38] non-reg: 豚肉エキス -> haram', verdict30('豚肉エキス').status, 'haram');
check('[exp38] non-reg: 麦芽エキス -> halal', verdict30('麦芽エキス').status, 'halal');
check('[exp38] non-reg: 乳化剤 -> syubhat', verdict30('乳化剤').status, 'syubhat');
check('[exp38] non-reg: 大豆レシチン -> halal', verdict30('大豆レシチン').status, 'halal');
check('[exp38] non-reg: レシチン -> syubhat', verdict30('レシチン').status, 'syubhat');
check('[exp38] non-reg: E120 -> syubhat', verdict30('E120').status, 'syubhat');
check('[exp38] non-reg: E100 -> halal', verdict30('E100').status, 'halal');

// Deliberately unlabelled / guarded tokens.
check('[exp38] 漂白剤 NOT halal', verdict30('漂白剤').status !== 'halal', true);
check('[exp38] ラー油 NOT halal (near ラード)', verdict30('ラー油').status !== 'halal', true);
check('[exp38] カオマス NOT halal (OCR fragment)', verdict30('カオマス').status !== 'halal', true);
check('[exp38] bare パウダー is label noise', isLabelNoise(normalize('パウダー')), true);
check('[exp38] bare フィリング is label noise', isLabelNoise(normalize('フィリング')), true);
check('[exp38] bare あたり is label noise', isLabelNoise(normalize('あたり')), true);

// Labelled total: curated data (ingredients + ecodes) + keyword rules.
const labCurated = loadCurated().entries.length;
const labRules = CURATION_RULES.length;
check('[exp38] curated data files grew past 1700', labCurated > 1700, true);
check('[exp38] LABELLED TOTAL (curated + rules) >= 2000', labCurated + labRules >= 2000, true);

// 39. Independent-verifier fixes: haram-shadow guard, cystine source risk,
// cautious prepared meat, alcohol-seasoning rules, corpus gaps, half-width
// separators, metadata corrections.
const finding39 = (raw: string) =>
  analyzeLayered(getCuratedIndex(), getCatalogIndex(), raw).find((f) => f.match);

// Haram-shadow guard: a near-haram typo must not be promoted by fuzzy matching.
check('[fix39] ラート NOT halal (haram-shadow guard)', verdict30('ラート').status !== 'halal', true);
check('[fix39] ラート no longer fuzzy-matches exp:ビート', verdict30('ラート').id === 'exp:ビート', false);
check('[fix39] ラード still haram (exact)', verdict30('ラード').status, 'haram');
check('[fix39] ビート still halal', verdict30('ビート').status, 'halal');

// Cystine is source-dependent, same risk class as L-cysteine.
check('[fix39] シスチン -> syubhat', verdict30('シスチン').status, 'syubhat');
check('[fix39] シスチン confidence medium', finding39('シスチン')?.match?.entry.confidence, 'medium');
// The rule layer must also exclude シスチン: the bulk expander skips rule-matched
// tokens, so this is what stops it being re-added as a halal amino acid.
check('[fix39] シスチン amino-acid exclusion rule', matchRule(normalize('シスチン'))?.id, 'l-cysteine');

// Generic seasoned mince can be pork depending on the product.
check('[fix39] 味付挽肉 NOT halal', verdict30('味付挽肉').status !== 'halal', true);
check('[fix39] 味付挽肉 -> syubhat', verdict30('味付挽肉').status, 'syubhat');
check('[fix39] 味付挽肉 confidence low', finding39('味付挽肉')?.match?.entry.confidence, 'low');
check('[fix39] 味付豚挽肉 still haram', verdict30('味付豚挽肉').status, 'haram');

// Metadata / confidence corrections from the same audit.
check('[fix39] exp:タラガム category additive', finding39('タラガム')?.match?.entry.category, 'additive');
check('[fix39] exp:はちみつパウダー category animal', finding39('はちみつパウダー')?.match?.entry.category, 'animal');
check('[fix39] exp:ドーナツ confidence low', finding39('ドーナツ')?.match?.entry.confidence, 'low');
check('[fix39] exp:味付スパゲッティ confidence low', finding39('味付スパゲッティ')?.match?.entry.confidence, 'low');

// Alcohol masked by plant / ph-adjuster / seasoning rules.
for (const raw of [
  'もも浸漬酒',
  'レモン浸漬酒',
  'ラムレーズン',
  'PH調整剤酒精',
  '酒精PH調整剤',
  '植物油脂粉末調味料酒',
  '調味料酒',
]) {
  check(`[fix39] ${raw} -> syubhat`, verdict30(raw).status, 'syubhat');
}
check('[fix39] alcohol-seasoning rule id', verdict30('もも浸漬酒').id, 'rule:alcohol-seasoning');
check('[fix39] ラムレーズン rule id', verdict30('ラムレーズン').id, 'rule:alcohol-seasoning');
check('[fix39] 啤酒 -> haram', verdict30('啤酒').status, 'haram');
check('[fix39] 啤酒 beer rule id', verdict30('啤酒').id, 'rule:beer');

// Corpus gaps.
check('[fix39] タマゴ -> halal', verdict30('タマゴ').status, 'halal');
check('[fix39] でんぷん -> halal', verdict30('でんぷん').status, 'halal');
check('[fix39] リン -> halal', verdict30('リン').status, 'halal');
check('[fix39] リンゴ still halal (apple, not phosphorus)', verdict30('リンゴ').status, 'halal');
check('[fix39] リンゴ apple rule id', verdict30('リンゴ').id, 'rule:apple');
check('[fix39] 漂白剤 -> syubhat', verdict30('漂白剤').status, 'syubhat');
check('[fix39] 色素 -> syubhat', verdict30('色素').status, 'syubhat');

// Half-width comma must split before normalization.
check('[fix39] 赤ワイン､食塩 splits into 2 tokens', extractCandidates('赤ワイン､食塩').length, 2);
const splitWine39 = analyzeLayered(getCuratedIndex(), getCatalogIndex(), '赤ワイン､食塩');
check(
  '[fix39] 赤ワイン､食塩 -> 赤ワイン haram',
  splitWine39.find((f) => f.normalized === '赤ワイン')?.match?.entry.status,
  'haram'
);

// Non-regressions.
check('[fix39] non-reg: 植物油脂 -> halal', verdict30('植物油脂').status, 'halal');
check('[fix39] non-reg: ビート -> halal', verdict30('ビート').status, 'halal');
check('[fix39] non-reg: 麦芽エキス -> halal', verdict30('麦芽エキス').status, 'halal');
check('[fix39] non-reg: 豚肉エキス -> haram', verdict30('豚肉エキス').status, 'haram');

// 40. Haram-shadow guard collateral: legitimate foods were left unknown because
// they sit within the guard's length-aware edit distance of a curated haram term
// (ぶどう ~ ぶどう酒, ぶどう酢 ~ ぶどう酒, パイン ~ ワイン). They are fixed with
// EXACT curated entries; the guard itself is untouched, and ぶどう酒/ラード stay
// haram exact entries.
check('[fix40] ぶどう -> halal (grapes)', verdict30('ぶどう').status, 'halal');
check('[fix40] ぶどう curated grape id', verdict30('ぶどう').id, 'grape');
check('[fix40] ブドウ -> halal', verdict30('ブドウ').status, 'halal');
check('[fix40] 葡萄 -> halal', verdict30('葡萄').status, 'halal');
check('[fix40] ぶどう酢 -> halal (grape vinegar)', verdict30('ぶどう酢').status, 'halal');
check('[fix40] ぶどう酢 NOT haram', notHaram('ぶどう酢'), true);
check('[fix40] ぶどう糖 -> halal (glucose, curated exact)', verdict30('ぶどう糖').status, 'halal');
check('[fix40] ぶどう糖 curated glucose id', verdict30('ぶどう糖').id, 'glucose');
check('[fix40] ぶどう酒 -> haram (wine, curated exact)', verdict30('ぶどう酒').status, 'haram');
check('[fix40] ぶどう酒 curated wine id', verdict30('ぶどう酒').id, 'wine');
check('[fix40] 葡萄酢 -> halal', verdict30('葡萄酢').status, 'halal');
check('[fix40] パイン -> halal (pineapple abbreviation)', verdict30('パイン').status, 'halal');
check('[fix40] ラード -> haram (lard, exact)', verdict30('ラード').status, 'haram');
check('[fix40] ラート NOT halal (guard intact)', verdict30('ラート').status !== 'halal', true);
check('[fix40] ラート no longer fuzzy-matches exp:ビート', verdict30('ラート').id === 'exp:ビート', false);
check('[fix40] ビート -> halal (non-reg)', verdict30('ビート').status, 'halal');
check('[fix40] non-reg: 植物油脂 -> halal', verdict30('植物油脂').status, 'halal');
check('[fix40] non-reg: 豚肉エキス -> haram', verdict30('豚肉エキス').status, 'haram');
check('[fix40] non-reg: 麦芽エキス -> halal', verdict30('麦芽エキス').status, 'halal');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
