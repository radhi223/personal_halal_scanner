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
import { searchIngredients } from '@/lib/search';
import { computeVerdictBanner, effectiveStatus } from '@/lib/verdict';
import type { HalalStatus } from '@/types';
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
// 2026-09-27: 796 -> 538 entries after the generator fix (community-only bogus
// E-codes dropped, 81 multi-name mappings collapsed, 43 status conflicts fixed).
// The count dropped because the data got TRUSWORTHY, not smaller.
check('ecode table loaded (>500)', ecodeEntries.length > 500, true);
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
// 2026-09-27: E420 is the one intentional curated/ecode divergence — MUIS (2016)
// marks sorbitol doubtful (contamination concern) while the curated entry treats
// the sugar alcohol itself as halal. Curated is the display layer and wins.
const E420_ALLOWED = new Set(['E420']);
let unexpectedConflicts = 0;
for (const e of curatedEntries) {
  if (!e.eNumber) continue;
  if (!ecoMap.has(e.eNumber)) continue;
  if (ecoMap.get(e.eNumber) === e.status) continue;
  if (E420_ALLOWED.has(e.eNumber)) continue;
  unexpectedConflicts++;
}
check('no curated/ecode status conflicts (E420 allowed)', unexpectedConflicts, 0);

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
check('チャツネ -> chutney', s10m.get(normalize('チャツネ'))?.entry.id, 'exp:en-chutney');
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

// 21b. GAP-1 follow-up: the crop must absorb list lines that wrapped BEFORE the
// 原材料名 marker (same backwards rule as extractIngredientSection). Otherwise
// those leading ingredients are cut away on device before OCR ever sees them.
// 名称 / 種類別 metadata lines still stop absorption.
const wrappedList = {
  text: '',
  blocks: [
    {
      text: '',
      lines: [
        { text: '名称ピザパン', frame: { top: 40, left: 0, width: 300, height: 30 } },
        { text: '小麦粉（国内製造）、砂糖、', frame: { top: 80, left: 0, width: 500, height: 40 } },
        { text: 'マヨネーズ、ハム', frame: { top: 120, left: 0, width: 400, height: 40 } },
        { text: '原材料名 プン、乳化剤、調味料', frame: { top: 160, left: 0, width: 500, height: 40 } },
        { text: '栄養成分表示 熱量393kcal', frame: { top: 220, left: 0, width: 400, height: 40 } },
      ],
    },
  ],
} as any;
const wrappedCrop = computeIngredientCrop(wrappedList, 1000, 2000);
check('[gap1-crop] mid-list header absorbs wrapped list lines', wrappedCrop?.rect.originY, 56);
check(
  '[gap1-crop] crop starts at/above first absorbed line',
  (wrappedCrop?.rect.originY ?? 999) <= 80,
  true
);
check(
  '[gap1-crop] crop does not swallow product-name line',
  (wrappedCrop?.rect.originY ?? 0) > 40,
  true
);
check('[gap1-crop] crop height covers absorbed lines', wrappedCrop?.rect.height, 168);
check('[gap1-crop] absorbed lines counted in diagnostic', wrappedCrop?.lines, 3);

const cropNameOnly = {
  text: '',
  blocks: [
    {
      text: '',
      lines: [
        { text: '名称ピザパン', frame: { top: 40, left: 0, width: 300, height: 30 } },
        { text: '原材料名 プン、乳化剤', frame: { top: 100, left: 0, width: 500, height: 40 } },
        { text: '栄養成分表示', frame: { top: 160, left: 0, width: 300, height: 40 } },
      ],
    },
  ],
} as any;
check(
  '[gap1-crop] 名称 line NOT absorbed (crop starts at header)',
  computeIngredientCrop(cropNameOnly, 1000, 2000)?.rect.originY,
  76
);

const cropTypeOnly = {
  text: '',
  blocks: [
    {
      text: '',
      lines: [
        { text: '種類別: プロセスチーズ', frame: { top: 40, left: 0, width: 400, height: 30 } },
        { text: '原材料名 ナチュラルチーズ、乳化剤', frame: { top: 100, left: 0, width: 500, height: 40 } },
        { text: '栄養成分表示', frame: { top: 160, left: 0, width: 300, height: 40 } },
      ],
    },
  ],
} as any;
check(
  '[gap1-crop] 種類別 line NOT absorbed (crop starts at header)',
  computeIngredientCrop(cropTypeOnly, 1000, 2000)?.rect.originY,
  76
);

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
check('[fix32] ham rule id', verdict30('ハム').id, 'exp:en-ham');
// The curated ハム exact entry now wins; the rule must still cover compound forms.
check('[fix32] ham rule still covers ロースハム', verdict30('ロースハム').id, 'rule:ham');
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
// 2026-09-27 policy corrections (E3 audit): プロピレングリコール is synthetic
// (petrochemical, no animal/plant doubt) and ローヤルゼリー is a bee product
// (LPPOM treats bee products as halal) — both moved to halal, verified below.
const EXP_SYUBHAT: [string, string][] = [
  ['保湿剤', 'syubhat'],
  ['結着材料', 'syubhat'],
  ['ソルビタン', 'syubhat'],
  ['つなぎ', 'syubhat'], // exact entry prevents fuzzy→うなぎ(halal)
  ['ラック', 'syubhat'], // insect resin — same doubt class as carmine, NOT a pork template
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
// 2026-09-27 policy corrections (E3 audit) — both halal now, with reasoning
// updated in the curated entries; the syubhat entries above keep the rest.
check('[exp38] プロピレングリコール -> halal (synthetic)', verdict30('プロピレングリコール').status, 'halal');
check('[exp38] ローヤルゼリー -> halal (bee product, LPPOM)', verdict30('ローヤルゼリー').status, 'halal');
check('[exp38] ソルビトール -> halal (sugar alcohol; MUIS note kept)', verdict30('ソルビトール').status, 'halal');
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
// 2026-09-27: curated data shrank from 1731 to 1468 entries — 258 bogus E-codes
// (codes present in neither the OFF taxonomy nor MUIS, carrying community names
// attached to the wrong numbers) were removed, and 3 garbage fragment entries
// (硫酸 / 膨剤-garble / 梅酢バウダー) were deleted. Fewer but correct.
check('[exp38] curated data files past 1400', labCurated > 1400, true);
check('[exp38] LABELLED TOTAL (curated + rules) >= 1700', labCurated + labRules >= 1700, true);
check('[exp38] no community-only E-codes remain', ecodeEntries.length < 600, true);

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

// 41. Verdict banner decision table (trust-critical): the green "safe" banner
// must only appear when every matched ingredient has a reviewed verdict. Zero
// matches, low-quality OCR, and unreviewed-only matches are never "safe".
const banner = (
  haram: number,
  syubhat: number,
  halal: number,
  unknown: number,
  matched: number,
  lowQuality = false,
  unmatched = 0
) =>
  computeVerdictBanner({ haram, syubhat, halal, unknown, matched, unmatched, lowQuality });

const bannerCases: [string, ReturnType<typeof banner>, string, string][] = [
  ['haram present -> danger', banner(1, 0, 2, 0, 3), 'danger', 'Ditemukan bahan haram'],
  ['haram+syubhat -> danger (haram wins)', banner(1, 2, 0, 0, 3), 'danger', 'Ditemukan bahan haram'],
  ['syubhat only -> caution', banner(0, 1, 2, 0, 3), 'caution', 'Ada bahan yang perlu diperhatikan'],
  ['matched=0 -> unknown, no safety claim', banner(0, 0, 0, 0, 0), 'unknown', 'Tidak ada bahan yang dikenali'],
  [
    'matched=0 + lowQuality -> unreadable-photo unknown',
    banner(0, 0, 0, 0, 0, true),
    'unknown',
    'Foto kurang jelas — teks hampir tidak terbaca',
  ],
  ['lowQuality, reviewed matches -> unknown', banner(0, 0, 2, 0, 2, true), 'unknown', 'Hasil mungkin kurang akurat'],
  ['unknown-only -> unknown', banner(0, 0, 0, 2, 2), 'unknown', 'Hanya bahan yang belum ditinjau'],
  ['unknown+halal -> caution', banner(0, 0, 1, 1, 2), 'caution', 'Sebagian bahan belum ditinjau'],
  ['all reviewed -> ok', banner(0, 0, 3, 0, 3), 'ok', 'Semua bahan yang dikenali sudah ditinjau'],
  ['haram+lowQuality -> danger (precedence)', banner(1, 0, 0, 0, 1, true), 'danger', 'Ditemukan bahan haram'],
  // P0-2: unmatched tokens must never yield the green `ok` banner.
  [
    '3 halal matched + 8 unmatched -> caution (not ok)',
    banner(0, 0, 3, 0, 3, false, 8),
    'caution',
    'Sebagian bahan belum ada di database',
  ],
  ['3 halal matched + 0 unmatched -> ok', banner(0, 0, 3, 0, 3, false, 0), 'ok', 'Semua bahan yang dikenali sudah ditinjau'],
];

for (const [label, v, tone, title] of bannerCases) {
  check(`[verdict] ${label}: tone`, v.tone, tone);
  check(`[verdict] ${label}: title`, v.title, title);
}

check(
  '[verdict] matched=0 never claims safety',
  banner(0, 0, 0, 0, 0).title.includes('Tidak ditemukan bahan bermasalah'),
  false
);
check(
  '[verdict] matched=0 detail does not claim safety',
  banner(0, 0, 0, 0, 0).detail.includes('0 cocok dengan database'),
  true
);
check(
  '[verdict] matched=0 + lowQuality gives photo-retry detail',
  banner(0, 0, 0, 0, 0, true).detail.includes('foto ulang lebih dekat'),
  true
);
// P0-2: the green banner must be unreachable while any token is unmatched.
check(
  '[verdict] unmatched blocks ok tone',
  banner(0, 0, 3, 0, 3, false, 8).tone === 'ok',
  false
);
check(
  '[verdict] unmatched caution detail carries counts',
  banner(0, 0, 3, 0, 3, false, 8).detail,
  '3 halal • 8 belum bisa dinilai • 3 bahan cocok'
);
check(
  '[verdict] danger detail notes unmatched when present',
  banner(1, 0, 2, 0, 3, false, 4).detail,
  '1 haram • 0 syubhat • 3 bahan cocok • 4 belum ada di database'
);
check(
  '[verdict] danger detail omits unmatched note when zero',
  banner(2, 1, 0, 0, 3, false, 0).detail,
  '2 haram • 1 syubhat • 3 bahan cocok'
);
check(
  '[verdict] danger detail carries counts',
  banner(2, 1, 0, 0, 3).detail,
  '2 haram • 1 syubhat • 3 bahan cocok'
);
check(
  '[verdict] unknown-only detail carries counts',
  banner(0, 0, 0, 2, 2).detail,
  '2 dari 2 bahan belum ditinjau • belum ada penilaian'
);
check(
  '[verdict] ok detail carries counts',
  banner(0, 0, 3, 0, 3).detail,
  '3 bahan cocok • 3 halal • tidak ada temuan'
);

// 41. Real-image validation baseline fixes (110-label corpus). These are the
// DATA/RULE gaps the first real-photo run exposed, plus the two false syubhat
// verdicts caused by OCR fragments fuzzy-matching the wrong curated entry
// (ソルビン酸 -> carmine, トリン -> mirin).
const FIX41: [string, string][] = [
  ['ミノ酸等', 'halal'], // アミノ酸等 with the leading ア lost
  ['三ノ酸等', 'halal'], // ミ misread as 三
  ['三酸等', 'halal'],
  ['ミノ酸', 'halal'],
  ['ソルビン酸', 'halal'], // sorbic acid (E200), all salts
  ['ソルビン酸K', 'halal'],
  ['トリン', 'halal'], // dextrin fragment
  ['ストリン', 'halal'], // 難消化性 ストリン fragment
  ['難消化性', 'halal'],
  ['難消化性デキストリン', 'halal'],
  ['食物繊', 'halal'], // 食物繊維 truncated
  ['ウスタ一ース', 'syubhat'], // ウスターソース with 一 for ー
  ['ウスターソース', 'syubhat'],
  ['発風味料', 'syubhat'], // 発酵風味料 truncated
  ['発酵風味料', 'syubhat'],
  ['ビ一チ', 'halal'], // ビート OCR alias
  ['ビ一ト', 'halal'],
];
for (const [raw, status] of FIX41) {
  check(`[fix41] ${raw} -> ${status}`, verdict30(raw).status, status);
}
check('[fix41] ミノ酸等 rule id', verdict30('ミノ酸等').id, 'rule:amino-acid');
check('[fix41] ソルビン酸 rule id', verdict30('ソルビン酸').id, 'rule:potassium-sorbate');
check('[fix41] ソルビン酸 NOT carmine (false syubhat fixed)', verdict30('ソルビン酸').id !== 'carmine', true);
check('[fix41] トリン rule id', verdict30('トリン').id, 'rule:dextrin');
check('[fix41] トリン NOT mirin (false syubhat fixed)', verdict30('トリン').id !== 'mirin', true);
check('[fix41] 食物繊 rule id', verdict30('食物繊').id, 'rule:dietary-fiber');
check('[fix41] ウスタ一ース rule id', verdict30('ウスタ一ース').id, 'rule:sauce');
check('[fix41] 発風味料 rule id', verdict30('発風味料').id, 'rule:fermented-seasoning');
check('[fix41] ビ一チ curated beet id', verdict30('ビ一チ').id, 'exp:ビート');
// The dextrin fragments are anchored: OCR soup that merely CONTAINS トリン must
// not inherit a halal verdict. (脱脂粉乳デストリンクリー is halal for a
// legitimate reason — 脱脂粉乳 — so the guard token is pure garbage.)
check('[fix41] クリンゲルトリン NOT halal (anchored fragment)', verdict30('クリンゲルトリン').status !== 'halal', true);
// The old false-verdict sources stay exactly as before.
check('[fix41] カルミン酸 still syubhat', verdict30('カルミン酸').status, 'syubhat');
check('[fix41] ミリン still syubhat', verdict30('ミリン').status, 'syubhat');
// /三酸/ must not shadow the earlier phosphate/citric rules.
check('[fix41] リン酸三ナトリウム still phosphate', verdict30('リン酸三ナトリウム').id, 'rule:phosphate');
check('[fix41] クエン酸三ナトリウム still citric', verdict30('クエン酸三ナトリウム').id, 'rule:citric');
// Non-regressions.
check('[fix41] デキストリン still halal', verdict30('デキストリン').status, 'halal');
check('[fix41] 食物繊維 still halal', verdict30('食物繊維').status, 'halal');
check('[fix41] 発酵調味料 still syubhat', verdict30('発酵調味料').status, 'syubhat');
check('[fix41] ビート still halal', verdict30('ビート').status, 'halal');
check('[fix41] アミノ酸 still halal', verdict30('アミノ酸').status, 'halal');
check('[fix41] non-reg: 植物油脂 -> halal', verdict30('植物油脂').status, 'halal');
check('[fix41] non-reg: 豚肉エキス -> haram', verdict30('豚肉エキス').status, 'haram');
check('[fix41] non-reg: E120 -> syubhat', verdict30('E120').status, 'syubhat');
check('[fix41] non-reg: 乳化剤 -> syubhat', verdict30('乳化剤').status, 'syubhat');
check('[fix41] non-reg: レシチン -> syubhat', verdict30('レシチン').status, 'syubhat');

// 42. First real-image validation fixes (docs/VALIDATION_BASELINE.md). Ordinary
// Japanese words / guide prose are now EXACT-only label noise, and the matcher
// refuses fuzzy matches on short or ASCII brand fragments. These tokens used to
// get FALSE VERDICTS: ただし → syubhat 白だし (5 CAA pages), 加工所 → syubhat
// 加工酢, 薬ラベル → halal ミラベル, Asahi → syubhat dashi.
const noVerdict42 = (raw: string) =>
  !analyzeLayered(getCuratedIndex(), getCatalogIndex(), raw).some((f) => f.match);

for (const raw of ['ただし', '加工所', '薬ラベル', 'Asahi']) {
  check(`[fix42] ${raw} produces NO verdict`, noVerdict42(raw), true);
}
check('[fix42] ただし dropped as label noise', isLabelNoise(normalize('ただし')), true);
check('[fix42] 加工所 dropped as label noise', isLabelNoise(normalize('加工所')), true);
check('[fix42] 薬ラベル dropped as label noise', isLabelNoise(normalize('薬ラベル')), true);

// Every word added to NOISE_EXACT must classify as label noise.
for (const noise of [
  'ただし', 'なお', 'また', '上記', '別表', '個別的', '定義', '方式', '規制',
  '事項', '止事項', '様式', '樣式', 'ポイント', '留意点', '該当', '加工所',
  '薬ラベル', '加工食品', '保存', '由来', '開封後', '記載', '表示', '別紙',
  '参考', '例示', '抜粋', '出典', '目次',
]) {
  check(`[fix42] noise: ${noise}`, isLabelNoise(normalize(noise)), true);
}
// Exact-only must NOT swallow real ingredients that merely CONTAIN a word.
for (const keep of ['保存料', '白だし', '加工酢', 'ミラベル', '油脂加工食品']) {
  check(`[fix42] not noise: ${keep}`, isLabelNoise(normalize(keep)), false);
}

// The genuine food tokens keep their verdicts.
check('[fix42] 白だし still syubhat', verdict30('白だし').status, 'syubhat');
check('[fix42] 白だし rule id', verdict30('白だし').id, 'shiro-dashi');
check('[fix42] 加工酢 still syubhat', verdict30('加工酢').status, 'syubhat');
// ミラベル is a real curated ingredient (Mirabelle plum, halal EXACT). The fix
// only forbids a FUZZY halal verdict — the 薬ラベル ≈ ミラベル path is gone.
check('[fix42] ミラベル no fuzzy verdict', matchTerm(getCuratedIndex(), 'ミラベル')?.kind === 'fuzzy', false);

// Non-regressions for the high-stakes set.
check('[fix42] 乳化剤 -> syubhat', verdict30('乳化剤').status, 'syubhat');
check('[fix42] 小麦粉 -> halal', verdict30('小麦粉').status, 'halal');
check('[fix42] 豚肉 -> haram', verdict30('豚肉').status, 'haram');
check('[fix42] アミノ酸等 -> halal', verdict30('アミノ酸等').status, 'halal');
check('[fix42] ミノ酸等 -> halal', verdict30('ミノ酸等').status, 'halal');

// 43. Offline ingredient search (search.ts). The verdict for a typed token
// must be identical to a scan of the same token (layered: curated exact >
// rule > fuzzy curated > catalog), and catalog hits must NEVER surface as a
// verdict — the vegan origin-signal "halal" candidate in particular.
const S = (q: string, limit = 30) =>
  searchIngredients(getCuratedIndex(), getCatalogIndex(), q, limit);

const gelatin43 = S('ゼラチン');
check('[search] ゼラチン top layer curated', gelatin43.hits[0]?.layer, 'curated');
check('[search] ゼラチン top id gelatin', gelatin43.hits[0]?.entry.id, 'gelatin');
check('[search] ゼラチン top status syubhat', gelatin43.hits[0]?.status, 'syubhat');
check('[search] ゼラチン exact', gelatin43.hits[0]?.kind, 'exact');
check('[search] ゼラチン matched alias', gelatin43.hits[0]?.matchedTerm, 'ゼラチン');
check('[search] ゼラチン total', gelatin43.total, 1);

const emulsifier43 = S('乳化剤');
check('[search] 乳化剤 top id emulsifier', emulsifier43.hits[0]?.entry.id, 'emulsifier');
check('[search] 乳化剤 top status syubhat', emulsifier43.hits[0]?.status, 'syubhat');

const mirin43 = S('みりん');
check('[search] みりん top id mirin', mirin43.hits[0]?.entry.id, 'mirin');
check('[search] みりん top status syubhat', mirin43.hits[0]?.status, 'syubhat');

const e120Search = S('E120');
check('[search] E120 top id ecode:E120', e120Search.hits[0]?.entry.id, 'ecode:E120');
check('[search] E120 top status syubhat', e120Search.hits[0]?.status, 'syubhat');

const e100Search = S('E100');
check('[search] E100 top id ecode:E100', e100Search.hits[0]?.entry.id, 'ecode:E100');
check('[search] E100 top status halal', e100Search.hits[0]?.status, 'halal');

const nonsense43 = S('謎の物質XYZ');
check('[search] nonsense -> no hits', nonsense43.hits.length, 0);
check('[search] nonsense total 0', nonsense43.total, 0);

// Catalog-only name クスクス. The raw catalog entry carries a vegan
// origin-signal mapped to status 'halal'; search must display 'unknown'.
const couscous43 = S('クスクス');
check('[search] catalog-only layer catalog', couscous43.hits[0]?.layer, 'catalog');
check('[search] catalog-only entry id', couscous43.hits[0]?.entry.id, 'catalog:couscous');
check('[search] catalog-only entry has vegan halal candidate', couscous43.hits[0]?.entry.status, 'halal');
check('[search] catalog-only display status unknown', couscous43.hits[0]?.status, 'unknown');

// Fuzzy agreement with the scan matcher.
const fuzzy43 = S('ゼラチソ'); // ソ instead of ン
check('[search] fuzzy typo -> gelatin', fuzzy43.hits[0]?.entry.id, 'gelatin');
check('[search] fuzzy kind', fuzzy43.hits[0]?.kind, 'fuzzy');

// Prefix browse aid + limit/total accounting.
const prefix43 = S('ゼラ');
check(
  '[search] prefix suggests ゼラチン',
  prefix43.hits.some((h) => h.entry.id === 'gelatin' && h.kind === 'prefix'),
  true
);
const limited43 = S('E', 5);
check('[search] limit caps returned hits', limited43.hits.length, 5);
check('[search] total counts all matches', limited43.total > 5, true);
check('[search] truncated flag', limited43.truncated, true);

const blank43 = S('   ');
check('[search] blank query -> no hits', blank43.total, 0);

// 44. Golden-set fixes (docs/VALIDATION_GOLDENSET.md): named plant colourants
// are halal while generic 着色料/香料 stay syubhat, 豆腐用凝固剤 no longer
// inherits the 豆腐 halal through the compound term, the golden-set DATA-GAPs
// get curated verdicts (or a cautious one), and merged OCR-soup tokens are
// dropped before matching.
check(
  '[goldenset] OCR soup token is label noise',
  isLabelNoise(normalize('豆腐用凝固 部含 熱量78kca一蛋 牛')),
  true
);
check(
  '[goldenset] OCR soup token yields no halal verdict',
  analyzeLayered(
    getCuratedIndex(),
    getCatalogIndex(),
    '豆腐用凝固 部含 熱量78kca一蛋 牛'
  ).some((f) => f.match?.entry.status === 'halal'),
  false
);
// Guard must NOT drop normal long ingredient names (esp. alcohol-safety tokens).
for (const keep of [
  '植物油脂粉末調味料酒',
  'たん白加水分解物',
  '粉末状大豆たん白',
  '酵母エキスパウダー',
  'ミックス粉',
]) {
  check(`[goldenset] not noise: ${keep}`, isLabelNoise(normalize(keep)), false);
}
check(
  '[goldenset] 植物油脂粉末調味料酒 still syubhat (alcohol rule intact)',
  verdict30('植物油脂粉末調味料酒').status,
  'syubhat'
);

check('[goldenset] 豆腐 -> halal', verdict30('豆腐').status, 'halal');
check('[goldenset] 豆腐 rule id', verdict30('豆腐').id, 'rule:tofu');
check('[goldenset] 豆腐用凝固剤 -> syubhat', verdict30('豆腐用凝固剤').status, 'syubhat');
check(
  '[goldenset] 豆腐用凝固剤 rule id',
  verdict30('豆腐用凝固剤').id,
  'rule:tofu-coagulant'
);
check('[goldenset] 凝固剤 -> syubhat (could be rennet/enzyme)', verdict30('凝固剤').status, 'syubhat');
check('[goldenset] 凝固剤 rule id', verdict30('凝固剤').id, 'exp:en-coagulant');
check('[goldenset] coagulant rule still fires', matchRule(normalize('凝固剤'))?.id, 'coagulant');

const NAMED_COLORANTS: [string, string][] = [
  ['カラメル色素', 'halal'],
  ['パプリカ色素', 'halal'],
  ['野菜色素', 'halal'],
  ['クチナシ色素', 'halal'],
  ['アナトー色素', 'halal'],
  ['ビート色素', 'halal'],
  ['紅麹色素', 'halal'],
  ['カロテノイド色素', 'halal'],
  ['カロチノイド色素', 'halal'],
  ['カロチン色素', 'halal'],
  ['ベニコウジ色素', 'halal'],
];
for (const [raw, status] of NAMED_COLORANTS) {
  check(`[goldenset] ${raw} -> ${status}`, verdict30(raw).status, status);
}
check('[goldenset] named colourant rule id', verdict30('カラメル色素').id, 'exp:en-caramel-color');
check('[goldenset] named-colourant rule still fires', verdict30('パプリカ色素').id, 'rule:named-colorant');
check('[goldenset] 着色料 still syubhat', verdict30('着色料').status, 'syubhat');
check('[goldenset] 色素 still syubhat', verdict30('色素').status, 'syubhat');
check('[goldenset] 香料 still syubhat', verdict30('香料').status, 'syubhat');
check('[goldenset] コチニール色素 still syubhat', verdict30('コチニール色素').status, 'syubhat');
check('[goldenset] 乳化剤 still syubhat', verdict30('乳化剤').status, 'syubhat');

check('[goldenset] リン酸塩 -> halal', verdict30('リン酸塩').status, 'halal');
check('[goldenset] 生クリーム -> halal', verdict30('生クリーム').status, 'halal');
check('[goldenset] 大豆水煮 -> halal', verdict30('大豆水煮').status, 'halal');
check('[goldenset] 酢酸Na -> halal', verdict30('酢酸Na').status, 'halal');
check('[goldenset] しいたけ -> halal', verdict30('しいたけ').status, 'halal');
check('[goldenset] しいたけだし -> halal', verdict30('しいたけだし').status, 'halal');
// 加工デンプン is modified starch: syubhat, NOT halal. The earlier expectation
// encoded a conflicting curated entry (exp:加工テンブン, halal) that was merged
// into modified-starch after verifier round 2.
check('[goldenset] 加工デンプン -> syubhat', verdict30('加工デンプン').status, 'syubhat');
check(
  '[goldenset] 加工デンプン curated id',
  verdict30('加工デンプン').id,
  'modified-starch'
);
check(
  '[goldenset] イーストフード -> syubhat (dough conditioner)',
  verdict30('イーストフード').status,
  'syubhat'
);
check(
  '[goldenset] イーストフード rule id',
  verdict30('イーストフード').id,
  'rule:yeast-food'
);
check('[goldenset] パン酵母 still halal', verdict30('パン酵母').status, 'halal');

// 45. GAP-1 EXTRACT-GAP: 原材料名 is often detected AFTER the list already
// started (OCR reading order on two-column panels; PaddleOCR's `flatten:true`
// joins all OCR lines, so the whole leading list sits before the marker).
// `extractIngredientSection` now absorbs the list-like prefix. The fixture is
// the REAL flattened PaddleOCR text of personal/fldb_4902410315353_label.jpg
// (the worst image in docs/VALIDATION_GOLDENSET.md: 14 leading ingredients,
// incl. ハム/チーズ, were silently dropped).
const FLD_4902410315353_OCR =
  '名称菜パン 小麦粉(国内 造）、ピザソ一ス、マヨ 一ズ味 レシ 、タマ 、砂糖、 一ズ、、卵、 マ一ガリン、パン酵母、ショートニング、ぶどう糖、乳等を主要原料とする食品、食塩/加エデ 原材料名 プン、乳化剂、調味料(有機酸等)、酢酸Na、增粘多糖類、イ一ストフ一ド、リ 酸塩(Na)、pH 調整剂、<ん液、酸化防止剤(V.C)、着色料(クチナシ、カロチノイド)、V.C、発色剤(亜硝酸 Na)、香辛料、（一部(に卵·乳成分·小麦·大豆·鶏肉·豚肉を含む） 内容量1個消費期限表面に記载保存方法直射日光、高温多湿を避けて保存してください。 パ 株 式会 社 467-8651名古屋市瑞穗区松園町1-50 ★製造所固有記号は消費期限の下に記載 ●本品製造ラインでは落花生・くるみを含む製品を生産しています。';

const fldSection = extractIngredientSection(FLD_4902410315353_OCR);
check('[gap1] fldb_4902410315353 section starts at leading list', fldSection.startsWith('小麦粉'), true);
check('[gap1] fldb_4902410315353 keeps post-marker list', fldSection.includes('プン、乳化剂'), true);
check('[gap1] fldb_4902410315353 drops product-name line', fldSection.includes('名称'), false);
check(
  '[gap1] fldb_4902410315353 recovers 砂糖/食塩/ショートニング/ぶどう糖',
  ['砂糖', '食塩', 'ショートニング', 'ぶどう糖'].every((t) => fldSection.includes(t)),
  true
);
const fldFind = new Map(
  analyzeLayered(getCuratedIndex(), getCatalogIndex(), fldSection)
    .filter((f) => f.match)
    .map((f) => [f.normalized, f.match!])
);
check('[gap1] recovered 小麦粉 -> halal', fldFind.get(normalize('小麦粉'))?.entry.status, 'halal');
check('[gap1] recovered 食塩 -> halal', fldFind.get(normalize('食塩'))?.entry.status, 'halal');
check('[gap1] recovered ショートニング -> syubhat', fldFind.get(normalize('ショートニング'))?.entry.status, 'syubhat');
check('[gap1] recovered ぶどう糖 -> halal', fldFind.get(normalize('ぶどう糖'))?.entry.status, 'halal');
check(
  '[gap1] split 加工デンプン rejoined',
  fldFind.get(normalize('加エデ プン'))?.entry.id,
  'modified-starch'
);
// ハム itself is absent from this OCR run: PaddleOCR dropped the token between
// チーズ and 卵 (the printed list is …砂糖、チーズ、ハム、卵…, so the OCR shows
// "…砂糖、 一ズ、、卵…"). No extractor can invent a token the OCR never
// emitted. Restoring the human-verified ハム into the SAME real text proves the
// fixed extractor keeps it where the old one lost the whole leading list, and
// the matcher returns the high-stakes haram verdict.
check(
  '[gap1] fldb_4902410315353 OCR itself never emitted ハム (separate OCR gap)',
  FLD_4902410315353_OCR.includes('ハム'),
  false
);
const fldRestored = extractIngredientSection(
  FLD_4902410315353_OCR.replace('一ズ、、卵', '一ズ、ハム、卵')
);
check('[gap1] restored ハム survives extraction', fldRestored.includes('ハム'), true);
check(
  '[gap1] restored ハム -> haram',
  analyzeLayered(getCuratedIndex(), getCatalogIndex(), fldRestored).find(
    (f) => f.normalized === normalize('ハム')
  )?.match?.entry.status,
  'haram'
);

// Multi-line OCR shape (ML Kit): the marker line is preceded by list lines.
const LEAD_LIST = `名称 惣菜パン
小麦粉（国内製造）、ピザソース、
マヨネーズ味ドレッシング、タマネギ、砂糖、チーズ、
ハム、卵、マーガリン
原材料名 パン酵母、ショートニング、ぶどう糖
栄養成分表示 熱量 393kcal`;
const leadSection = extractIngredientSection(LEAD_LIST);
check('[gap1] multi-line section starts before marker', leadSection.startsWith('小麦粉'), true);
check('[gap1] multi-line section keeps ハム', leadSection.includes('ハム'), true);
check('[gap1] multi-line section drops 名称', leadSection.includes('名称'), false);
check('[gap1] multi-line section stops at nutrition', leadSection.includes('栄養成分'), false);
const leadFind = analyzeLayered(getCuratedIndex(), getCatalogIndex(), leadSection);
check(
  '[gap1] multi-line ハム -> haram',
  leadFind.find((f) => f.normalized === normalize('ハム'))?.match?.entry.status,
  'haram'
);
check(
  '[gap1] multi-line 小麦粉 -> halal',
  leadFind.find((f) => f.normalized === normalize('小麦粉'))?.match?.entry.status,
  'halal'
);

// Negative guards: the product-name block and the 種類別 field are metadata,
// not list continuation, and must never be absorbed.
const PRODUCT_NAME = `名称ー菓子パン
ダブルチョコロール*
原材料名 チョコレート利用食品（国内製造）、小麦粉
栄養成分表示 熱量 1kcal`;
const pnSection = extractIngredientSection(PRODUCT_NAME);
check('[gap1] product name not swallowed', pnSection.startsWith('チョコレート利用食品'), true);
check('[gap1] product-name continuation not swallowed', pnSection.includes('ダブルチョコロール'), false);

const TYPE_FIELD = `種類別: プロセスチーズ
原材料名 ナチュラルチーズ（外国製造）、乳化剤
栄養成分表示 熱量 1kcal`;
const tfSection = extractIngredientSection(TYPE_FIELD);
check('[gap1] 種類別 line not swallowed', tfSection.startsWith('ナチュラルチーズ'), true);
check('[gap1] 種類別 value not in section', tfSection.includes('プロセスチーズ'), false);

// 46. GAP-2 DEDUPE-GAP: collapse() now dedupes by normalized surface form, not
// by entry id, so different ingredients that share a database entry all show.
const gap2 = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  '牛脂豚脂混合油脂、牛脂、香辛料、香辛料抽出物、砂糖混合ぶどう糖果糖液糖、果糖ぶどう糖液糖'
);
const gap2Raw = new Set(gap2.filter((f) => f.match).map((f) => f.raw));
check('[gap2] 牛脂 survives next to 牛脂豚脂混合油脂', gap2Raw.has('牛脂'), true);
check('[gap2] 香辛料抽出物 survives next to 香辛料', gap2Raw.has('香辛料抽出物'), true);
check(
  '[gap2] 果糖ぶどう糖液糖 survives next to 砂糖混合ぶどう糖果糖液糖',
  gap2Raw.has('果糖ぶどう糖液糖'),
  true
);
check(
  '[gap2] longer siblings still survive',
  ['牛脂豚脂混合油脂', '香辛料', '砂糖混合ぶどう糖果糖液糖'].every((t) => gap2Raw.has(t)),
  true
);
const gap2ByRaw = new Map(gap2.filter((f) => f.match).map((f) => [f.raw, f.match!]));
check('[gap2] 牛脂豚脂混合油脂 -> haram', gap2ByRaw.get('牛脂豚脂混合油脂')?.entry.status, 'haram');
check('[gap2] 牛脂 -> syubhat', gap2ByRaw.get('牛脂')?.entry.status, 'syubhat');
check('[gap2] 香辛料抽出物 -> halal', gap2ByRaw.get('香辛料抽出物')?.entry.status, 'halal');
check('[gap2] 果糖ぶどう糖液糖 -> halal', gap2ByRaw.get('果糖ぶどう糖液糖')?.entry.status, 'halal');
// Same surface form is still collapsed to one card (no duplicate explosion).
const sameWord = analyzeLayered(getCuratedIndex(), getCatalogIndex(), '砂糖、砂糖、食塩、食塩');
check(
  '[gap2] identical form appears once (sugar)',
  sameWord.filter((f) => f.normalized === normalize('砂糖')).length,
  1
);
check(
  '[gap2] identical form appears once (salt)',
  sameWord.filter((f) => f.normalized === normalize('食塩')).length,
  1
);

// 46b. Same entry id, different surface forms: collapse() dedupes by normalized
// form, so both must survive and each render its own result card.
const sharedEntry = analyzeLayered(getCuratedIndex(), getCatalogIndex(), '牛脂、香辛料抽出物');
check(
  '[gap2] two rule-matched findings both survive',
  sharedEntry.filter((f) => f.match).length,
  2
);
const sameIdPair = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  '香辛料、香辛料抽出物'
);
const sameIdMatched = sameIdPair.filter((f) => f.match);
check('[gap2] same-id pair yields 2 findings', sameIdMatched.length, 2);
check(
  '[gap2] same-id pair really shares one entry',
  new Set(sameIdMatched.map((f) => f.match!.entry.id)).size,
  1
);
const sameIdRaw = new Set(sameIdMatched.map((f) => f.raw));
check(
  '[gap2] same-id pair keeps both raw forms',
  sameIdRaw.has('香辛料') && sameIdRaw.has('香辛料抽出物'),
  true
);

// 47. On-device scan regressions (4 real scans, 2026-09-27). Every case below
// was observed in the device log and produced a wrong or missing verdict before
// the fix. Each one is pinned here so it cannot come back.
const device = (text: string) => {
  const f = analyzeLayered(getCuratedIndex(), getCatalogIndex(), text)[0];
  return f && f.match ? `${f.match.entry.status}:${f.match.entry.id}` : null;
};

// 47a. OCR misreads of 調味料 must fold to seasoning, not fuzzy-match 苦味料.
check('[dev] 添味料 -> seasoning', device('添味料'), 'halal:rule:seasoning');
check('[dev] 譲味料 -> seasoning', device('譲味料'), 'halal:rule:seasoning');
check('[dev] 翻味料 -> seasoning', device('翻味料'), 'halal:rule:seasoning');

// 47b. 加工でん粉 misread must stay syubhat (was halal through /でん粉/).
check('[dev] カエでん粉 -> modified starch', device('カエでん粉'), 'syubhat:modified-starch');

// 47c. パーム油 misread must stay halal palm oil (was unreviewed catalog).
check('[dev] バーム油 -> palm oil', device('バーム油'), 'halal:rule:palm-oil');

// 47d. Short-fuzzy gate: レート (a チョコレート fragment) must never match ビート.
const rate = analyzeLayered(getCuratedIndex(), getCatalogIndex(), 'レート')[0];
check('[dev] レート is not ビート', rate?.match?.entry.id === 'exp:ビート', false);
// Positive control: a genuine OCR confusion still fuzzy-matches through the gate.
const masuko = analyzeLayered(getCuratedIndex(), getCatalogIndex(), '増古剤')[0];
check('[dev] 増古剤 still fuzzy-matches', masuko?.match?.kind, 'fuzzy');

// 47e. Garbled allergen declaration must not become an "egg halal" finding.
const allergenSoup = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  '部仁卵乳成分小麦天豆肉を含t'
);
check('[dev] garbled allergen line yields no finding', allergenSoup.length, 0);

// 47f. A meat mention inside an allergen declaration is a real signal...
check('[dev] 一部に豚肉を含む -> haram', device('一部に豚肉を含む'), 'haram:rule:pork');
// ...but cross-contamination wording is not an ingredient claim.
const crossContam = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  '一部に豚肉を含む製品を製造しています'
);
check('[dev] cross-contamination line yields no finding', crossContam.length, 0);

// 47g. A nutrition row glued onto the list must be dropped as a whole, while its
// real ingredient pieces survive (豆腐用凝固 would otherwise vanish silently).
const glued = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  '(加工でん粉) 豆腐用凝固 部含 熱量78kca一蛋 牛'
);
check(
  '[dev] glued nutrition segment dropped as a whole',
  glued.every((f) => f.raw !== '豆腐用凝固 部含 熱量78kca一蛋 牛'),
  true
);
check(
  '[dev] 豆腐用凝固 survives inside a glued segment',
  glued.some((f) => f.normalized === normalize('豆腐用凝固') && f.match?.entry.status === 'syubhat'),
  true
);

// 48. Verifier round 2 findings (2026-09-27).
// 48a. OCR-fragment curated entries were deleted; the remaining fragment must
// never resolve to halal (ル色素 used to fuzzy-match the garbage exp:メル色素).
const ruShikiso = analyzeLayered(getCuratedIndex(), getCatalogIndex(), 'ル色素')[0];
check('[ver2] ル色素 is not halal', ruShikiso?.match?.entry.status === 'halal', false);

// 48b. 加工デンプン (modified starch) must be syubhat in KATAKANA too — it used
// to exact-match a conflicting curated halal entry.
check('[ver2] 加工デンプン -> syubhat', device('加工デンプン'), 'syubhat:modified-starch');
check('[ver2] 加工デンプ -> syubhat', device('加工デンプ'), 'syubhat:modified-starch');
check('[ver2] 加工でん粉 -> syubhat', device('加工でん粉'), 'syubhat:modified-starch');

// 48c. Duplicate normalized names with different statuses must resolve to the
// STRICTEST verdict. The ecodes generator fix (2026-09-27) removed ALL real
// duplicate-name conflicts (44 -> 0), so the guard is now exercised with a
// synthetic index instead of live data.
const strictRank: Record<string, number> = { haram: 0, syubhat: 1, unknown: 2, halal: 3 };
const byName = new Map<string, string[]>();
for (const e of loadCurated().entries) {
  for (const n of e.names) {
    const k = normalize(n);
    if (!k) continue;
    const list = byName.get(k) ?? [];
    list.push(e.status);
    byName.set(k, list);
  }
}
let strictViolations = 0;
let unexpectedNameConflicts = 0;
// 2026-10-03: one duplicate-name conflict reappeared with the data
// regeneration. "sodium caseinate" is named by BOTH the curated `casein` entry
// (syubhat — a source-dependent milk protein) and ecode entry E469 (halal from
// the ecodes generator). Strictest-wins resolves the live index to syubhat, so
// the safety property below is intact; the pair is allowlisted so this check
// still catches any NEW conflict. The data cleanup belongs to the
// ingredients/ecodes generators, not this smoke suite.
const KNOWN_NAME_CONFLICTS = new Set(['sodiumcaseinate']);
for (const [name, statuses] of byName) {
  const uniq = [...new Set(statuses)];
  if (uniq.length < 2) continue;
  if (!KNOWN_NAME_CONFLICTS.has(name)) unexpectedNameConflicts += 1;
  const strictest = uniq.sort((a, b) => strictRank[a] - strictRank[b])[0];
  const resolved = getCuratedIndex().exact.get(name)?.status;
  if (resolved !== strictest) strictViolations += 1;
}
check('[ver2] no unexpected duplicate-name conflicts (known casein/E469 allowed)', unexpectedNameConflicts, 0);
check('[ver2] known duplicate resolves to strictest (syubhat)', getCuratedIndex().exact.get('sodiumcaseinate')?.status, 'syubhat');
check('[ver2] duplicate names resolved strictly (live data)', strictViolations, 0);
// Synthetic guard: the strictest-wins logic itself must never regress.
const syntheticDup = buildIndex([
  { id: 'dup-halal', names: ['デュープテスト'], status: 'halal', category: 'additive', reasoning: '', sources: [] },
  { id: 'dup-haram', names: ['デュープテスト'], status: 'haram', category: 'animal', reasoning: '', sources: [] },
] as never);
check(
  '[ver2] duplicate-name strictness guard (synthetic)',
  syntheticDup.exact.get(normalize('デュープテスト'))?.status,
  'haram'
);

// 48d. effectiveStatus: an unreviewed OFF-vegan halal must display as unknown.
check(
  '[ver2] unreviewed halal -> unknown',
  effectiveStatus({ status: 'halal', reviewed: false }),
  'unknown'
);
check(
  '[ver2] reviewed halal stays halal',
  effectiveStatus({ status: 'halal', reviewed: true }),
  'halal'
);
check(
  '[ver2] unreviewed syubhat stays syubhat',
  effectiveStatus({ status: 'syubhat', reviewed: false }),
  'syubhat'
);

// 48e. Cross-contamination / possibility / negation wordings must not claim a
// meat ingredient, while genuine claims must.
for (const wording of [
  '豚肉を含むことがございます',
  '豚肉を含む事があります',
  '豚肉を含むケースがあります',
  '豚肉を含む恐れがあります',
  '豚肉を含むことが稀にあります',
  '豚肉が混入するおそれ',
  '豚肉を使った設備',
  '豚肉は入っていません',
  '豚肉を使用しておりません',
  '豚肉を使用しない',
  '豚肉を含む製品を製造しています',
  // verifier round 3: facility / negation forms still missed.
  '豚肉を取り扱う設備',
  '豚肉を扱う設備',
  '豚肉を含む商品を取り扱っています',
  '豚肉が使われていない',
  'ラードを使わない',
  '豚肉エキス不添加',
  // verifier round 4: ordinary inflections.
  '豚肉を使っていない',
  '豚肉は一切使ってない',
  '豚肉を使うことはない',
  '豚肉を配合していない',
  '豚肉を含んでいない',
  '豚肉は添加していない',
  '豚肉を使っていない製品',
  '豚肉ゼロ',
  'ポークを使っていない',
  'ゼラチンを使っていない',
  '鶏肉なし',
  '牛肉フリー',
  '本製品は豚肉を使用していません',
]) {
  const found = analyzeLayered(getCuratedIndex(), getCatalogIndex(), wording);
  check(`[ver2] not an ingredient claim: ${wording}`, found.length, 0);
}
// Verifier round 3: bare 使用 / 製品 are POSITIVE claims and must survive. The
// first attempt at this guard dropped them, silently deleting animal-derived
// ingredients (false-green risk).
check('[ver3] 牛肉を使用した調味料 -> syubhat', device('牛肉を使用した調味料'), 'syubhat:rule:beef');
check('[ver3] 豚肉製品 -> haram', device('豚肉製品'), 'haram:rule:pork');
check('[ver3] チキン製品 -> syubhat', device('チキン製品'), 'syubhat:rule:chicken');
check('[ver3] ゼラチン使用 -> syubhat', device('ゼラチン使用'), 'syubhat:rule:gelatin');
check('[ver3] 豚肉(使用) -> haram', device('豚肉(使用)'), 'haram:pork');
check('[ver3] 豚肉エキス -> haram', device('豚肉エキス'), 'haram:pork-extract');
check('[ver3] 鶏がらスープ -> syubhat', device('鶏がらスープ'), 'syubhat:rule:chicken');
// Verifier round 4: 製造/工場/不使用 are substrings of REAL ingredient names —
// these were silently dropped, turning the banner green next to halal items.
check('[ver4] 製造用豚肉エキス -> haram', device('製造用豚肉エキス'), 'haram:rule:pork');
check('[ver4] 豚肉工場製造 -> haram', device('豚肉工場製造'), 'haram:rule:pork');
check('[ver4] 工場直送豚肉 -> haram', device('工場直送豚肉'), 'haram:rule:pork');
check('[ver4] 牛肉を製造工程で使用 -> syubhat', device('牛肉を製造工程で使用'), 'syubhat:rule:beef');
check('[ver4] 鶏肉と洋なし -> syubhat (なし = pear, not a negation)', device('鶏肉と洋なし'), 'syubhat:rule:chicken');
const compoundLine = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  '豚肉不使用のラード入り食品'
);
check(
  '[ver4] compound negation+claim keeps the claim',
  compoundLine.some((f) => f.match?.entry.status === 'haram'),
  true
);
check('[ver2] 一部に豚肉を含む -> haram', device('一部に豚肉を含む'), 'haram:rule:pork');
check('[ver2] 豚肉、玉ねぎ -> haram', device('豚肉、玉ねぎ、にんじん'), 'haram:pork');
check('[ver2] 豚肉を含む食用油脂 -> haram', device('豚肉を含む食用油脂'), 'haram:rule:pork');

// 48f. Pure-indel exception recovers dropped-glyph fragments...
check('[ver2] ゼチン -> gelatin syubhat', device('ゼチン'), 'syubhat:gelatin');
check('[ver2] マントン -> lamb syubhat', device('マントン'), 'syubhat:lamb');
// ...but a 3-char unrelated substitution is still refused.
const rateAgain = analyzeLayered(getCuratedIndex(), getCatalogIndex(), 'レート')[0];
check('[ver2] レート still not ビート', rateAgain?.match?.entry.id === 'exp:ビート', false);

// 48g. Confusion-map additions (kanji shape + hira/kata) recover real terms.
check('[ver2] 上自糖 -> sugar', device('上自糖'), 'halal:sugar');
check('[ver2] 木醸造 -> syubhat', device('木醸造'), 'syubhat:exp:本醸造');
check('[ver2] 鳥龍茶 -> halal', device('鳥龍茶'), 'halal:exp:烏龍茶');
check('[ver2] びーフ -> beef syubhat', device('びーフ'), 'syubhat:beef');

// 48h. Verifier round 5: meat CUTS were falling through to plant rules —
// 豚もも肉 matched the peach rule and reported HALAL next to halal items.
check('[ver5] 豚もも肉 -> haram', device('豚もも肉'), 'haram:rule:pork');
check('[ver5] 豚ひき肉 -> haram', device('豚ひき肉'), 'haram:rule:pork');
check('[ver5] 豚レバー -> haram', device('豚レバー'), 'haram:rule:pork');
check('[ver5] 豚肩ロース -> haram', device('豚肩ロース'), 'haram:rule:pork');
check('[ver5] 豚タン -> haram', device('豚タン'), 'haram:rule:pork');
check('[ver5] 鶏もも肉 -> syubhat', device('鶏もも肉'), 'syubhat:rule:chicken');
check('[ver5] 牛もも肉 -> syubhat', device('牛もも肉'), 'syubhat:rule:beef');
check('[ver5] ラムもも肉 -> syubhat', device('ラムもも肉'), 'syubhat:rule:lamb');
check('[ver5] もも肉 -> syubhat meat cut', device('もも肉'), 'syubhat:rule:meat-cut');
check('[ver5] ひき肉 -> syubhat meat cut', device('ひき肉'), 'syubhat:rule:meat-cut');
// -ose sugars must NOT be meat cuts (トレハロース contains ロース).
const treha = analyzeLayered(getCuratedIndex(), getCatalogIndex(), 'トレハロース')[0];
check('[ver5] トレハロース is not a meat cut', treha?.match?.entry.id === 'rule:meat-cut', false);
const sucro = analyzeLayered(getCuratedIndex(), getCatalogIndex(), 'スクロース')[0];
check('[ver5] スクロース is not a meat cut', sucro?.match?.entry.id === 'rule:meat-cut', false);
// Plants/dairy must not be swallowed by the meat-cut safety net.
check('[ver5] もも -> peach', device('もも'), 'halal:rule:peach');
check('[ver5] ローストオニオン -> onion', device('ローストオニオン'), 'halal:rule:onion');
check('[ver5] 牛乳 -> milk', device('牛乳'), 'halal:rule:milk');
check('[ver5] 鶏卵 -> egg', device('鶏卵'), 'halal:rule:egg');

// 48i. Verifier round 5: same-token negation + claim must keep the claim.
check('[ver5] 豚肉不使用の豚肉エキス入り -> haram', device('豚肉不使用の豚肉エキス入り'), 'haram:rule:pork');
check(
  '[ver5] 豚肉を使っていないが豚肉エキスは入っている -> haram',
  device('豚肉を使っていないが豚肉エキスは入っている'),
  'haram:rule:pork'
);

// 48j. Verifier round 6: more real meat names that produced NO finding (green
// banner beside halal items) and false positives from the broad cut patterns.
for (const [name, want] of [
  ['豚トロ', 'haram:rule:pork'],
  ['豚ミノ', 'haram:rule:pork'],
  ['豚ガツ', 'haram:rule:pork'],
  ['豚の角煮', 'haram:rule:pork'],
  ['焼き豚', 'haram:rule:pork'],
  ['豚汁', 'haram:rule:pork'],
  ['とんかつ', 'haram:rule:pork'],
  ['トンカツ', 'haram:rule:pork'],
  ['猪肉', 'haram:rule:pork'],
  ['スパム', 'haram:rule:pork'],
  ['地鶏', 'syubhat:rule:chicken'],
  ['鴨肉', 'syubhat:rule:chicken'],
  ['焼き鳥', 'syubhat:rule:chicken'],
  ['砂肝', 'syubhat:rule:chicken'],
  ['合いびき肉', 'syubhat:rule:meat-cut'],
  ['挽き肉', 'syubhat:rule:meat-cut'],
  ['びき肉', 'syubhat:rule:meat-cut'],
  ['メンチカツ', 'syubhat:rule:meat-cut'],
  ['背脂', 'syubhat:rule:meat-cut'],
  ['レバ刺し', 'syubhat:rule:meat-cut'],
  ['ハチノス', 'syubhat:rule:meat-cut'],
  ['センマイ', 'syubhat:rule:meat-cut'],
  ['アキレス腱', 'syubhat:rule:meat-cut'],
  ['フランクフルト', 'syubhat:rule:meat-cut'],
  ['サラミ', 'syubhat:rule:meat-cut'],
] as [string, string][]) {
  check(`[ver6] ${name} -> ${want}`, device(name), want);
}
// False positives from the broad cut patterns must not be meat.
for (const name of [
  'ローステッドオニオン',
  'ローステッドガーリック',
  'ローステッドポテト',
  'ロースター',
  'フカヒレ',
  'ランプフィッシュ',
  'サメ軟骨',
  'トレハロース',
  'スクロース',
  'スクラロース',
  'カクテルソース',
  'モッツァレラ',
  'もも',
  '桃',
  'もも果汁',
  'ローストオニオン',
  '牛乳',
  '牛蒡',
  '鶏卵',
  'ラムネ',
]) {
  const f = analyzeLayered(getCuratedIndex(), getCatalogIndex(), name)[0];
  const id = f?.match?.entry.id ?? '';
  check(
    `[ver6] ${name} is not meat`,
    ['rule:meat-cut', 'rule:pork', 'rule:chicken', 'rule:beef', 'rule:lamb'].includes(id),
    false
  );
}

// 49. Final-gate round 7: pork dishes were shadowed by halal sub-words
// (豚の生姜焼き -> rule:ginger halal) and katakana cuts / dish names produced no
// finding at all (green banner next to halal items).
for (const [name, want] of [
  ['豚の生姜焼き', 'haram:rule:pork'],
  ['豚みそ漬け', 'haram:rule:pork'],
  ['豚のりんご煮', 'haram:rule:pork'],
  ['豚のレモン煮', 'haram:rule:pork'],
  ['豚のにんにく炒め', 'haram:rule:pork'],
  ['豚モモ肉', 'haram:rule:pork'],
  ['豚スネ肉', 'haram:rule:pork'],
  ['豚ほほ肉', 'haram:rule:pork'],
  ['豚テキ', 'haram:rule:pork'],
  ['豚丼', 'haram:rule:pork'],
  ['豚まん', 'haram:rule:pork'],
  ['豚しゃぶ', 'haram:rule:pork'],
  ['豚キムチ', 'haram:rule:pork'],
  ['煮豚', 'haram:rule:pork'],
  ['豚ハラミ', 'haram:rule:pork'],
  ['豚背脂', 'haram:rule:pork'],
  ['リブロース', 'syubhat:rule:meat-cut'],
  ['モモ肉', 'syubhat:rule:meat-cut'],
  ['スネ肉', 'syubhat:rule:meat-cut'],
  ['モツ', 'syubhat:rule:meat-cut'],
  ['鶏モモ肉', 'syubhat:rule:chicken'],
  ['鶏白湯', 'syubhat:rule:chicken'],
  ['鶏団子', 'syubhat:rule:chicken'],
  ['焼鳥', 'syubhat:rule:chicken'],
  ['カモ', 'syubhat:rule:chicken'],
  ['牛モモ肉', 'syubhat:rule:beef'],
  ['牛スジ', 'syubhat:rule:beef'],
  ['牛丼', 'syubhat:rule:beef'],
  ['肉まん', 'syubhat:rule:meat-cut'],
  ['焼肉', 'syubhat:rule:meat-cut'],
  ['カツ丼', 'syubhat:rule:meat-cut'],
  ['餃子', 'syubhat:rule:meat-cut'],
  ['焼売', 'syubhat:rule:meat-cut'],
] as [string, string][]) {
  check(`[ver7] ${name} -> ${want}`, device(name), want);
}
for (const name of [
  'とんかつソース',
  '海豚',
  '河豚',
  'カツオ',
  'ハラミツ',
  'ウインナーコーヒー',
  '魚ミンチ',
  'コーンナゲット',
  'まぐろ角煮',
  'サメヒレ',
  '地鶏卵',
  '牛乳',
  '牛蒡',
  '鶏卵',
  'カモミール',
  'トレハロース',
  'スクロース',
  'ローステッドオニオン',
  'フカヒレ',
  'ミノ酸',
  'アミノ酸',
]) {
  const f = analyzeLayered(getCuratedIndex(), getCatalogIndex(), name)[0];
  const id = f?.match?.entry.id ?? '';
  check(
    `[ver7] ${name} is not meat`,
    ['rule:meat-cut', 'rule:pork', 'rule:chicken', 'rule:beef', 'rule:lamb'].includes(id),
    false
  );
}
// A mixed list with any meat item must never produce a green banner.
for (const list of [
  '砂糖、食塩、豚の生姜焼き',
  '砂糖、食塩、豚モモ肉',
  '砂糖、食塩、煮豚',
  '砂糖、食塩、鶏白湯',
  '砂糖、食塩、牛丼',
]) {
  const allFindings = analyzeLayered(getCuratedIndex(), getCatalogIndex(), list);
  const findings = allFindings.filter((f) => f.match);
  const unmatchedCount = allFindings.length - findings.length;
  const counts: Record<HalalStatus, number> = { haram: 0, syubhat: 0, halal: 0, unknown: 0 };
  for (const f of findings) counts[effectiveStatus(f.match!.entry)] += 1;
  const banner = computeVerdictBanner({
    haram: counts.haram,
    syubhat: counts.syubhat,
    halal: counts.halal,
    unknown: counts.unknown,
    matched: findings.length,
    unmatched: unmatchedCount,
    lowQuality: false,
  });
  check(`[ver7] banner not green: ${list}`, banner.tone === 'ok', false);
}

// 50. F1 audited fixes (src/lib/normalize.ts + src/lib/rules.ts): OCR garble
// folds, named colorants, plant hydrolyzed protein, single-char whitelist,
// English-label fallback, boilerplate noise. Every expected value was verified
// against the working tree before pinning.

// 50a. カ/オ garble folds to カツオ (bonito, FISH) and must never be a meat cut.
check('[f1] fold 力ツ扱 -> カツオ', normalize('力ツ扱'), 'カツオ');
check('[f1] カツ扱エキス -> katsuobushi halal', device('カツ扱エキス'), 'halal:bonito');
check('[f1] 力ツ扱節粉末 -> katsuobushi halal', device('力ツ扱節粉末'), 'halal:bonito');
check(
  '[f1] garble fold never yields meat-cut',
  analyzeLayered(getCuratedIndex(), getCatalogIndex(), 'カツ扱エキス')[0]?.match?.entry.id === 'rule:meat-cut',
  false
);
check('[f1] カツオエキス stays halal fish', device('カツオエキス'), 'halal:bonito');
// Curated bonito alias now wins; the katsuobushi rule must still cover compounds.
check('[f1] katsuobushi rule still fires', matchRule(normalize('カツオエキス'))?.id, 'katsuobushi');

// 50b. Plant vs animal hydrolyzed protein ordering.
check('[f1] 植物性蛋白加水分解物 -> plant rule', device('植物性蛋白加水分解物'), 'halal:rule:plant-hydrolyzed-protein');
check('[f1] 加水分解蛋白 still syubhat', device('加水分解蛋白'), 'syubhat:rule:hydrolyzed-protein');
check('[f1] plant rule precedes generic (matchRule)', matchRule(normalize('植物性蛋白加水分解物'))?.id, 'plant-hydrolyzed-protein');

// 50c. Named colorants: named -> halal, unnamed/insect -> syubhat.
check('[f1] 着色料（ウコン） -> named-colorant halal', device('着色料（ウコン）'), 'halal:rule:named-colorant');
check('[f1] 着色料（カラメル） -> halal', verdict30('着色料（カラメル）').status, 'halal');
check('[f1] bare 着色料 stays syubhat', device('着色料'), 'syubhat:rule:coloring');
check('[f1] 色素 stays syubhat', device('色素'), 'syubhat:rule:coloring');
check('[f1] コチニール色素 stays syubhat', device('コチニール色素'), 'syubhat:carmine');
const vegColorF1 = analyzeLayered(getCuratedIndex(), getCatalogIndex(), '着色料（野菜）');
check('[f1] 着色料（野菜） hits named-colorant', vegColorF1.some((f) => f.match?.entry.id === 'rule:named-colorant'), true);
check('[f1] 着色料（野菜） is halal', vegColorF1.some((f) => f.match?.entry.status === 'halal'), true);

// 50d. Long-vowel OCR misread.
check('[f1] マ一ガリン -> margarine', device('マ一ガリン'), 'syubhat:rule:margarine');

// 50e. Pizza sauce precedes the generic sauce rule.
check('[f1] ピザソース -> pizza-sauce', device('ピザソース'), 'halal:exp:en-pizza-sauce');
check('[f1] ピザ一ス -> pizza-sauce', device('ピザ一ス'), 'halal:rule:pizza-sauce');
check('[f1] bare ソース stays syubhat', device('ソース'), 'syubhat:rule:sauce');

// 50f. Natto. 納豆菌 has its own curated halal entry (exp:納豆菌), so the exact
// entry wins over rule:natto — same halal outcome.
check('[f1] 納豆 -> natto', device('納豆'), 'halal:rule:natto');
check('[f1] 納豆菌 -> halal (curated entry wins)', device('納豆菌'), 'halal:exp:納豆菌');

// 50g. タ -> 三 vitamin garbles.
check('[f1] ビ三C -> vitamin', device('ビ三C'), 'halal:rule:vitamin');
check('[f1] ビタ三ンc -> vitamin', device('ビタ三ンc'), 'halal:rule:vitamin');

// 50h. く -> "<" smoke-liquid garble.
check('[f1] <ん液 -> smoke', device('<ん液'), 'halal:rule:smoke');
check('[f1] くん液 -> smoke (non-reg)', device('くん液'), 'halal:rule:smoke');

// 50i. Single-char whitelist (F1 matcher fix). normalize.ts keeps
// 卵/米/酢/塩/油/乳/魚 through extraction; matcher.ts now resolves a length-1
// token ONLY via an EXACT reviewed (curated) entry. 酢 -> vinegar and 塩 -> salt
// are finally reachable; 魚 now resolves to the curated fish entry (was
// rule:fish); 卵/米 have no bare curated entry and still resolve by rule; 油/乳
// have no bare entry and stay unmatched (extraction-only).
check('[f1] single 卵 -> halal egg', device('卵'), 'halal:rule:egg');
check('[f1] single 米 -> halal rice', device('米'), 'halal:rule:rice');
check('[f1] single 魚 -> halal fish (curated exact)', device('魚'), 'halal:fish');
check('[f1] single 酢 -> vinegar curated entry', device('酢'), 'halal:vinegar');
check('[f1] single 塩 -> salt curated entry', device('塩'), 'halal:salt');
check('[f1] single 水 yields no finding', noVerdict42('水'), true);
check('[f1] single 肉 yields no finding', noVerdict42('肉'), true);
check('[f1] single 甘 yields no finding', noVerdict42('甘'), true);
for (const single of ['酢', '塩', '油', '乳']) {
  check(`[f1] single ${single} survives extraction`, extractCandidates(single).includes(single), true);
}
for (const single of ['油', '乳']) {
  check(`[f1] single ${single} yields no finding (no bare entry)`, noVerdict42(single), true);
}

// 50j. Mentaiko before fermented seasoning.
check('[f1] 明太子風味調味料 -> mentaiko', device('明太子風味調味料'), 'halal:rule:mentaiko');
check('[f1] bare 風味調味料 stays syubhat', device('風味調味料'), 'syubhat:rule:fermented-seasoning');

// 50k. English-label fallback in extractIngredientSection.
const enSectionF1 = extractIngredientSection('INGREDIENTS: SUGAR, FLOUR, SALT NUTRITION FACTS Serving Size 1 cup');
check('[f1] EN section keeps SUGAR', enSectionF1.includes('SUGAR'), true);
check('[f1] EN section drops nutrition tail', /NUTRITION|Serving Size/i.test(enSectionF1), false);
const enGarbledF1 = extractIngredientSection('MALTODEXTRIN et FaCts DerservngCalories 19 INGREDIENTS .382.');
check('[f1] garbled EN section keeps MALTODEXTRIN', enGarbledF1.includes('MALTODEXTRIN'), true);
check('[f1] garbled EN section drops INGREDIENTS tail', /INGREDIENTS/i.test(enGarbledF1), false);
check('[f1] garbled EN section drops Calories', /Calories/i.test(enGarbledF1), false);
check('[f1] garbled EN section drops barcode tail', enGarbledF1.includes('382'), false);
// Japanese-dominant text is never touched by the Latin fallback.
check('[f1] JP section untouched by EN fallback', extractIngredientSection('原材料名 豚肉、砂糖'), '豚肉、砂糖');

// 50l. Boilerplate noise added EXACT-only.
for (const noise of [
  '召し上がり', '買い上げ', '購入日', '天面', '側面記', '平日', '午前',
  '午後', 'サービス係', '健康補助食品', '問合せ', '問い合せ', '造りては',
]) {
  check(`[f1] noise: ${noise}`, isLabelNoise(normalize(noise)), true);
  check(`[f1] ${noise} produces NO finding`, noVerdict42(noise), true);
}
check('[f1] real 豆腐 still resolves', device('豆腐'), 'halal:rule:tofu');
check('[f1] real 胡椒 still resolves', device('胡椒'), 'halal:rule:spices');
check('[f1] real 食塩 still resolves', device('食塩'), 'halal:salt');

// 50m. ソルビトール curated halal change is pinned at [exp38] above; not duplicated.

// 50n. Vitamin Latin-abbreviation anchor (G4 pre-release blocker). The vitamin
// rule carried bare /vc/ and /ve/ (added for OCR abbreviations of ビタミンC/E),
// which matched ANY token containing them: VEAL (young beef) -> halal:vitamin
// and VERMOUTH (alcohol) -> halal. Both are false-halal on meat/alcohol. The
// Latin forms are now anchored to the WHOLE normalized token: /^v[ce](\d{1,2})?$/.
check('[f1] vc -> vitamin', device('vc'), 'halal:exp:アスコルビン酸');
check('[f1] ve -> vitamin', device('ve'), 'halal:rule:vitamin');
check('[f1] VC -> vitamin', device('VC'), 'halal:exp:アスコルビン酸');
check('[f1] V.C -> vitamin (normalize strips dot)', device('V.C'), 'halal:exp:アスコルビン酸');
check('[f1] VC12 -> vitamin', device('VC12'), 'halal:rule:vitamin');
check('[f1] VEAL is NOT halal (meat)', device('VEAL')?.startsWith('halal'), false);
check('[f1] VERMOUTH is NOT halal (alcohol)', device('VERMOUTH')?.startsWith('halal'), false);
// The vitamin rule itself must reject the Latin substrings (direct pattern test).
const vitaminRule = CURATION_RULES.find((r) => r.id === 'vitamin')!;
const vitaminPattern = (raw: string) => vitaminRule.patterns.some((p) => p.test(normalize(raw)));
for (const bad of ['VEAL', 'VERMOUTH', 'veal', 'verbena', 'velvet']) {
  check(`[f1] vitamin rule rejects '${bad}'`, vitaminPattern(bad), false);
}
for (const good of ['vc', 've', 'VC', 'V.C', 'VC12', 'ビタミンC', 'ビタミンE', 'ビ三C', 'ミンE']) {
  check(`[f1] vitamin rule accepts '${good}'`, vitaminPattern(good), true);
}

// 51. P4 curated English ingredient aliases + JP label terms (2026-10-03). These
// are the high-frequency English tokens that previously fell to the unreviewed
// catalog (unknown) on real OFF labels, plus the JP terms/OCR variants the dev
// golden set missed. Statuses follow HANDOVER §6 (plants/minerals/dairy -> halal;
// source-dependent additives -> syubhat; explicit pork -> haram).
// English aliases.
check('[p4] EGG -> halal', device('EGG'), 'halal:exp:en-egg');
check('[p4] EGG WHITES -> halal', device('EGG WHITES'), 'halal:exp:en-egg-white');
check('[p4] EGG YOLK POWDER -> halal', device('EGG YOLK POWDER'), 'halal:exp:en-egg');
check('[p4] MILK -> halal', device('MILK'), 'halal:exp:en-milk');
check('[p4] BUTTER -> halal', device('BUTTER'), 'halal:exp:en-butter');
check('[p4] バタ一 (OCR) -> halal', device('バタ一'), 'halal:exp:en-butter');
check('[p4] CREAM -> halal', device('CREAM'), 'halal:fresh-cream');
check('[p4] WHEAT -> halal', device('WHEAT'), 'halal:exp:en-wheat');
check('[p4] SOYBEAN -> halal', device('SOYBEAN'), 'halal:exp:en-soybean');
check('[p4] SOY FLOUR -> halal', device('SOY FLOUR'), 'halal:exp:en-soy-flour');
check('[p4] CORN STARCH -> halal', device('CORN STARCH'), 'halal:exp:en-corn-starch');
check('[p4] ROASTED BROWN RICE -> halal', device('ROASTED BROWN RICE'), 'halal:exp:en-brown-rice');
check('[p4] SEAWEED -> halal', device('SEAWEED'), 'halal:exp:en-seaweed');
check('[p4] SESAME SEED -> halal', device('SESAME SEED'), 'halal:exp:en-sesame-seed');
check('[p4] RAISINS -> halal', device('RAISINS'), 'halal:exp:en-raisin');
check('[p4] PEANUTS -> halal', device('PEANUTS'), 'halal:exp:en-peanut');
check('[p4] COCOA -> halal', device('COCOA'), 'halal:exp:en-cocoa');
check('[p4] VANILLA -> halal', device('VANILLA'), 'halal:exp:en-vanilla');
check('[p4] YEAST -> halal', device('YEAST'), 'halal:exp:en-yeast');
check('[p4] WATER -> halal', device('WATER'), 'halal:exp:en-water');
check('[p4] LACTOSE -> halal', device('LACTOSE'), 'halal:exp:en-lactose');
check('[p4] MALTODEXTRIN -> halal', device('MALTODEXTRIN'), 'halal:exp:en-maltodextrin');
check('[p4] HIGH FRUCTOSE CORN SYRUP -> halal', device('HIGH FRUCTOSE CORN SYRUP'), 'halal:exp:en-hfcs');
check('[p4] ASCORBIC ACID -> halal', device('ASCORBIC ACID'), 'halal:exp:アスコルビン酸');
check('[p4] SOY LECITHIN -> halal', device('SOY LECITHIN'), 'halal:soy-lecithin');
// Bare LECITHIN must stay syubhat (guards the soy-lecithin split).
check('[p4] bare LECITHIN stays syubhat', device('LECITHIN'), 'syubhat:lecithin');
// Source-dependent EN additives stay syubhat.
check('[p4] ENZYMES -> syubhat', device('ENZYMES'), 'syubhat:exp:en-enzyme');
check('[p4] MONO AND DIGLYCERIDES -> syubhat', device('MONO AND DIGLYCERIDES'), 'syubhat:monoglyceride');
check('[p4] EMULSIFIERS -> syubhat', device('EMULSIFIERS'), 'syubhat:emulsifier');
check('[p4] SHORTENING -> syubhat', device('SHORTENING'), 'syubhat:shortening');
check('[p4] MARGARINE -> syubhat', device('MARGARINE'), 'syubhat:exp:en-margarine');
check('[p4] L-CYSTEINE -> syubhat', device('L-CYSTEINE'), 'syubhat:l-cysteine');
check('[p4] MODIFIED FOOD STARCH -> syubhat', device('MODIFIED FOOD STARCH'), 'syubhat:modified-starch');
// Explicit pork stays haram.
check('[p4] BACON -> haram', device('BACON'), 'haram:exp:en-bacon');
check('[p4] HAM -> haram', device('HAM'), 'haram:exp:en-ham');
check('[p4] PORK BELLY -> haram', device('PORK BELLY'), 'haram:pork');
// Citric acid: E330 is ecode-syubhat; adding a curated halal name would create a
// duplicate-name conflict (strictest-wins would keep syubhat anyway). Pinned so
// nobody "fixes" it into a conflict.
check('[p4] CITRIC ACID stays ecode syubhat (no duplicate)', device('CITRIC ACID'), 'syubhat:ecode:E330');
// Adding バター must not soften バター入りマーガリン (rule order guard).
check('[p4] バター入りマーガリン stays syubhat', device('バター入りマーガリン'), 'syubhat:rule:margarine');
// JP terms / OCR variants.
check('[p4] オニオンエキス -> halal', matchTerm(getCuratedIndex(), 'オニオンエキス')?.entry.id, 'exp:en-onion');
check('[p4] ソテー・ド・オニオン -> halal', matchTerm(getCuratedIndex(), 'ソテー・ド・オニオン')?.entry.id, 'exp:en-onion');
check('[p4] 才二才 (OCR) -> onion halal', device('才二才'), 'halal:exp:en-onion');
check('[p4] ガーリックオイル -> halal', device('ガーリックオイル'), 'halal:exp:en-garlic');
check('[p4] チャツネ -> halal', device('チャツネ'), 'halal:exp:en-chutney');
check('[p4] chutney rule still fires', matchRule(normalize('チャツネ'))?.id, 'chutney');
check('[p4] ピザソ一ス (OCR) -> halal', device('ピザソ一ス'), 'halal:exp:en-pizza-sauce');
check('[p4] カラメル色素 -> halal', device('カラメル色素'), 'halal:exp:en-caramel-color');
// Bonito OCR variants must stay FISH-halal, never rule:meat-cut.
check('[p4] カツ才工キス -> bonito halal', device('カツ才工キス'), 'halal:bonito');
check('[p4] 力ツ才節粉末 -> bonito halal', device('力ツ才節粉末'), 'halal:bonito');
check('[p4] カツオ節粉末 -> bonito halal', device('カツオ節粉末'), 'halal:bonito');
// Unnamed defoamer/coagulant are source-dependent syubhat (defoamer guard: the
// rule layer has 消泡 halal, the curated exact must win).
check('[p4] 消泡剤 -> syubhat (defoamer)', device('消泡剤'), 'syubhat:exp:en-defoamer');
check('[p4] 消泡 (OCR) -> syubhat', device('消泡'), 'syubhat:exp:en-defoamer');
check('[p4] 凝固 -> syubhat (coagulant)', device('凝固'), 'syubhat:exp:en-coagulant');
// 52. FIX-A: expanded dev golden set (off2 transcripts, 2026-10-03). Modified
// starch and its OCR variants must be syubhat (a generic /でん粉|澱粉/ halal rule
// used to shadow the curated fuzzy hit), plus the ポ一ク long-vowel garble,
// truncated margarine, cream cheese vs the generic /クリーム/ halal rule, and the
// creaming-powder OCR variant. The garbage halal entries exp:加工プン /
// exp:加工アンプン / exp:加工デンナン were removed.
const FIXA: [string, string][] = [
  ['加工でん粉', 'syubhat'],
  ['加工デンプン', 'syubhat'],
  ['加工でんぷん', 'syubhat'],
  ['加工澱粉', 'syubhat'],
  ['化工デンプン', 'syubhat'],
  ['化工澱粉', 'syubhat'],
  ['酸化デンプン', 'syubhat'],
  ['酸化澱粉', 'syubhat'],
  ['酸化でん粉', 'syubhat'],
  ['加工テンプン', 'syubhat'],
  ['加エデンプン', 'syubhat'],
  ['カ工でん粉', 'syubhat'],
  ['エでん粉', 'syubhat'],
  ['加工プン', 'syubhat'],
  ['加工アンプン', 'syubhat'],
  ['加工デンナン', 'syubhat'],
  ['加工でん粉キサンタンセルロース', 'syubhat'],
  ['ダーノ加工澱粉', 'syubhat'],
  ['マ一ガリ', 'syubhat'],
  ['ポ一ク調味料', 'haram'],
  ['クリームチーズ', 'syubhat'],
  ['クリームチーズオースト', 'syubhat'],
  ['クー三グパウダー', 'syubhat'],
];
for (const [raw, status] of FIXA) {
  check(`[fixa] ${raw} -> ${status}`, verdict30(raw).status, status);
}
check('[fixa] 酸化デンプン curated id', verdict30('酸化デンプン').id, 'modified-starch');
check(
  '[fixa] merged 加工でん粉 token rule id',
  verdict30('加工でん粉キサンタンセルロース').id,
  'rule:modified-starch'
);
check('[fixa] ポ一ク調味料 rule id', verdict30('ポ一ク調味料').id, 'rule:pork');
check('[fixa] クリームチーズ rule id', verdict30('クリームチーズ').id, 'rule:cream-cheese');
check('[fixa] マ一ガリ rule id', verdict30('マ一ガリ').id, 'rule:margarine');
// Plain starch must stay halal: the new curated aliases must not leak into the
// unmodified forms through fuzzy matching or rule order.
for (const raw of ['でん粉', 'デンプン', '澱粉', 'でんぷん', '馬鈴薯でん粉', 'コーンスターチ']) {
  check(`[fixa] non-reg ${raw} -> halal`, verdict30(raw).status, 'halal');
}
check('[fixa] plain でん粉 stays rule:starch', verdict30('でん粉').id, 'rule:starch');
check(
  '[fixa] でん粉 no fuzzy curated match (エでん粉 rule-only)',
  matchTerm(getCuratedIndex(), 'でん粉'),
  null
);
// The removed expander garbage must never return as halal curated entries.
for (const raw of ['加工プン', '加工アンプン', '加工デンナン']) {
  check(
    `[fixa] ${raw} not a curated halal fragment`,
    verdict30(raw).status !== 'halal',
    true
  );
}

// Data hygiene: no duplicate normalized names inside the curated file and no NEW
// status conflict across ingredients.json + ecodes.json.
{
  const byName = new Map<string, string[]>();
  for (const e of loadCurated().entries) {
    if (e.id.startsWith('ecode:')) continue;
    for (const n of e.names) {
      const k = normalize(n);
      if (!k) continue;
      const list = byName.get(k) ?? [];
      list.push(`${e.id}|${e.status}`);
      byName.set(k, list);
    }
  }
  const dupNames = [...byName.entries()].filter(([, v]) => v.length > 1);
  check(
    '[p4] no duplicate normalized names in ingredients.json',
    dupNames,
    []
  );
}

// 53. FIX-C: expanded dev golden set, 2026-10-03 (5 remaining false-halal).
// Meat-extract seasoning tokens whose OCR garble lost the species stem were
// swallowed by the generic /調味料/ halal rule, and the strip-recovery OCR
// shredded the pork / modified-starch tokens so badly that no finding was
// emitted. The PHRASE_FOLD entries added to normalize.ts restore them. Every
// fold source was searched in the curated ingredient + ecode names, the catalog
// names and the ranked JP token corpus (jp-tokens-full.json): ZERO occurrences
// — they are unambiguous OCR garbage, not real words.
// 53a. The folds themselves (deterministic, exact, whitespace-bridging).
check('[fixc] fold ポ エキ -> ポークエキス', normalize('ポ エキ'), 'ポークエキス');
check('[fixc] fold ポ一ク -> ポーク', normalize('ポ一ク'), 'ポーク');
check('[fixc] fold ポ一ペ一ス -> ポークペースト', normalize('ポ一ペ一ス'), 'ポークペースト');
check('[fixc] fold チンエキス調味料 -> チキンエキス調味料', normalize('チンエキス調味料'), 'チキンエキス調味料');
check('[fixc] fold ビ一工ス調味料 -> ビーフエキス調味料', normalize('ビ一工ス調味料'), 'ビーフエキス調味料');
check(
  '[fixc] fold shredded starch -> 加工デンプン',
  normalize('加工 次增粘多理规查料着鱼料'),
  '加工デンプン'
);
// Real words are never touched by the new folds.
check('[fixc] idempotent ポークエキス', normalize('ポークエキス'), 'ポークエキス');
check('[fixc] idempotent チキンエキス', normalize('チキンエキス'), 'チキンエキス');
check('[fixc] idempotent ビーフエキス', normalize('ビーフエキス'), 'ビーフエキス');
check('[fixc] idempotent でん粉', normalize('でん粉'), 'でん粉');

// 53b. The five observed case tokens now resolve.
check('[fixc] ポ エキ -> haram (curated pork-extract)', device('ポ エキ'), 'haram:pork-extract');
check('[fixc] ポ一ペ一ス -> haram (pork rule)', device('ポ一ペ一ス'), 'haram:rule:pork');
check(
  '[fixc] チンエキス調味料 -> syubhat (animal-extract, not seasoning)',
  device('チンエキス調味料'),
  'syubhat:rule:animal-extract'
);
check(
  '[fixc] ビ一工ス調味料 -> syubhat (animal-extract, not seasoning)',
  device('ビ一工ス調味料'),
  'syubhat:rule:animal-extract'
);
check(
  '[fixc] shredded 加工デンプン chunk -> syubhat modified-starch',
  device('加工 次增粘多理规查料着鱼料'),
  'syubhat:modified-starch'
);
// The compound soup from case 1 (off2_4562214820950) must surface the pork.
const fixcSoup = analyzeLayered(
  getCuratedIndex(),
  getCatalogIndex(),
  'スープ（香味油、ポークエキス、しょうゆ、たん白加水分解物、砂糖、ポークペースト、食塩、発酵調味料、シーズニングペースト、香辛料）'
);
check(
  '[fixc] compound soup surfaces a haram finding',
  fixcSoup.some((f) => f.match?.entry.status === 'haram'),
  true
);

// 53c. Explicit animal-extract seasonings: the species status must beat the
// generic /調味料/ halal rule (rule array order already: animal-extract /
// pork / chicken / beef all precede seasoning — pinned here).
for (const [raw, want] of [
  ['チキンエキス調味料', 'syubhat:rule:animal-extract'],
  ['ビーフエキス調味料', 'syubhat:rule:animal-extract'],
  ['ポーク調味料', 'haram:rule:pork'],
  ['ポークエキス調味料', 'haram:rule:pork'],
  ['鶏エキス調味料', 'syubhat:rule:chicken'],
  ['牛エキス調味料', 'syubhat:rule:beef'],
] as [string, string][]) {
  check(`[fixc] ${raw} -> ${want}`, device(raw), want);
}

// 53d. Non-regressions: plain starch stays halal; bare meats unchanged; the
// generic seasoning stays halal; the beef-oil catalog token must NOT become
// ビーフエキス through the new fold.
for (const raw of ['でん粉', 'デンプン', '澱粉', 'でんぷん', 'コーンスターチ']) {
  check(`[fixc] non-reg ${raw} -> halal`, verdict30(raw).status, 'halal');
}
check('[fixc] non-reg でん粉 rule id', verdict30('でん粉').id, 'rule:starch');
check('[fixc] non-reg 調味料 -> halal generic', verdict30('調味料').id, 'rule:seasoning');
check('[fixc] non-reg 風味調味料 -> syubhat', verdict30('風味調味料').id, 'rule:fermented-seasoning');
check('[fixc] non-reg チキン -> syubhat', verdict30('チキン').status, 'syubhat');
check('[fixc] non-reg ビーフ -> syubhat', verdict30('ビーフ').status, 'syubhat');
check('[fixc] non-reg ポーク -> haram', verdict30('ポーク').status, 'haram');
check('[fixc] non-reg ポークエキス curated haram', verdict30('ポークエキス').id, 'pork-extract');
check('[fixc] non-reg 加工デンプン -> syubhat', verdict30('加工デンプン').status, 'syubhat');
check('[fixc] non-reg 増粘多糖類 -> halal', verdict30('増粘多糖類').status, 'halal');
check(
  '[fixc] non-reg 香味ビ一フ才イル is not animal-extract',
  verdict30('香味ビ一フ才イル').id === 'rule:animal-extract',
  false
);

// 54. FIX-A (2026-10-04): boundary-chopped modifier prefixes. The remaining
// false-halal on the dev golden set was off2_4902715927824: the label lists
// 加工でん粉 (modified starch, syubhat) but the flattened two-column OCR put the
// 加工 modifier on a later line that the 賞味期限 stop cut away, so the extracted
// section started at でん粉 and rule:starch (halal) won. The fix is a CLASS fix
// in normalize.ts: when the section's first token is a known base and the RAW
// OCR still contains a known modifier+base compound, the modifier is grafted
// back onto the boundary token. Bare starch, the compounds themselves and
// unrelated first tokens are non-regressions below.
const OFF2_4902715927824_RAW =
  'フラワートルラ チョップドハム 原材料名 でん粉、トレハ /酸等）、リン 発色剤（亜硝酸 内容量1本入 制造来\n' +
  '北云一小麦粉物油 八、物油乳 ハロース、 ーキングパウタ ン酸塩(Na)、pH調整剤、酸 肖酸Na)、 仓 發 撃 賞味期限 同面\n' +
  '油脂、シ トニング、砂糖 、プロセスチーズ、酵母工キ ウダ一、乳化剂、增粘剤(加上 酸化防止剤(V.C)、香料、着 辛料抽出物、（一部に卵乳） 面の左部に記載\n' +
  '少糖、小麦全粒粉、食塩）（国 エキス調味料、食塩、たん 加工でん粉、增粘多糖類、声 、着色料（カ口 ド、力儿 乳成分・小麦·大豆肉\n' +
  '（国内製造）、ナチラルチー 白加水分解物、水め 、アルギン酸Na)、調味料（ カルン酸、シスイン 自を含む）\n' +
  'チーズ、 /加工 料（ア三 V.B1、';
const off2Section = extractIngredientSection(OFF2_4902715927824_RAW);
check('[fixa-boundary] off2 section starts at 加工でん粉', off2Section.startsWith('加工でん粉'), true);
const off2Find = analyzeLayered(getCuratedIndex(), getCatalogIndex(), off2Section);
const off2First = off2Find.find((f) => f.raw === '加工でん粉');
check('[fixa-boundary] off2 加工でん粉 -> syubhat', off2First?.match?.entry.status, 'syubhat');
check('[fixa-boundary] off2 加工でん粉 curated id', off2First?.match?.entry.id, 'modified-starch');
check(
  '[fixa-boundary] off2 has no bare でん粉 halal finding',
  off2Find.some((f) => f.normalized === normalize('でん粉')),
  false
);

// Synthetic boundary variants: modifier+base lands after the 賞味期限 stop line
// (the exact chop shape), with OCR-injected whitespace, and with 酸化.
const chopped = extractIngredientSection(
  '原材料名 でん粉、トレハロース\n北云 賞味期限 2026.3\nたん 加工でん粉、増粘多糖類'
);
check('[fixa-boundary] chopped modifier grafted', chopped.startsWith('加工でん粉'), true);
check(
  '[fixa-boundary] chopped modifier -> syubhat',
  analyzeLayered(getCuratedIndex(), getCatalogIndex(), chopped).find((f) => f.raw === '加工でん粉')?.match?.entry
    ?.status,
  'syubhat'
);

const choppedSpace = extractIngredientSection(
  '原材料名 でん粉、増粘多糖類\nfoo 賞味期限 2026.3\n加工 でん粉、増粘多糖類'
);
check('[fixa-boundary] whitespace-split compound grafted', choppedSpace.startsWith('加工でん粉'), true);

const choppedOxidized = extractIngredientSection(
  '原材料名 デンプン、食塩\nfoo 賞味期限 2026.3\nbar 酸化デンプン、増粘多糖類'
);
check('[fixa-boundary] 酸化デンプン grafted', choppedOxidized.startsWith('酸化デンプン'), true);
const oxFind = analyzeLayered(getCuratedIndex(), getCatalogIndex(), choppedOxidized);
check(
  '[fixa-boundary] 酸化デンプン -> syubhat',
  oxFind.find((f) => f.raw === '酸化デンプン')?.match?.entry.status,
  'syubhat'
);

// No compound in the raw text -> nothing is grafted; bare starch stays halal.
const noCompound = extractIngredientSection(
  '原材料名 でん粉、トレハロース\n北云 賞味期限 2026.3\n増粘多糖類、食塩'
);
check('[fixa-boundary] no compound -> token untouched', noCompound.startsWith('でん粉'), true);
check(
  '[fixa-boundary] no compound -> でん粉 stays halal',
  analyzeLayered(getCuratedIndex(), getCatalogIndex(), noCompound).find((f) => f.raw === 'でん粉')?.match?.entry
    ?.status,
  'halal'
);

// A first token that is NOT the compound's base is never rewritten, even when
// the raw text carries a modifier+base elsewhere.
const unrelatedFirst = extractIngredientSection(
  '原材料名 食塩、砂糖\nfoo 賞味期限 2026.3\nbar 加工でん粉、増粘多糖類'
);
check('[fixa-boundary] unrelated first token untouched', unrelatedFirst.startsWith('食塩'), true);
check(
  '[fixa-boundary] no 加工食塩 invented',
  analyzeLayered(getCuratedIndex(), getCatalogIndex(), unrelatedFirst).some(
    (f) => f.normalized === normalize('加工食塩')
  ),
  false
);

// Already-whole compound is not double-prefixed; modifier before the marker is
// still recovered by absorbLeadingPrefix (covered), and the no-marker path uses
// the same repair.
check(
  '[fixa-boundary] already-whole compound not doubled',
  extractIngredientSection('原材料名 加工でん粉、増粘多糖類').startsWith('加工でん粉'),
  true
);
const noMarker = extractIngredientSection('でん粉、トレハロース\nfoo\n加工でん粉');
check('[fixa-boundary] no-marker path repairs first token', noMarker.startsWith('加工でん粉'), true);

// Non-regressions for the bare/compound verdicts themselves.
check('[fixa-boundary] でん粉 -> halal', verdict30('でん粉').status, 'halal');
check('[fixa-boundary] 加工でん粉 -> syubhat', verdict30('加工でん粉').status, 'syubhat');
check('[fixa-boundary] 酸化デンプン -> syubhat', verdict30('酸化デンプン').status, 'syubhat');
check('[fixa-boundary] でん粉 rule id', verdict30('でん粉').id, 'rule:starch');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
