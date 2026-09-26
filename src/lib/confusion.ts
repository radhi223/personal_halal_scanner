/**
 * OCR confusion model (Phase 2).
 *
 * Two mechanisms, both aimed at "kanji/kana the OCR got slightly wrong" WITHOUT
 * loosening the global threshold (which previously caused false positives like
 * グラム -> lamb):
 *
 *  1. `foldVariants` (see normalize.ts) — deterministic simplified/variant CJK
 *     -> Japanese shinjitai folding. Exact and safe.
 *
 *  2. This file: per-character substitution COSTS for the fuzzy matcher. A pair
 *     listed here is treated as a likely OCR shape confusion (cheap to swap);
 *     anything not listed keeps the default cost of 1.0, so genuinely different
 *     characters stay expensive.
 *
 * SAFETY: never add a pair that changes meaning for a high-risk item. In
 * particular 豚/牛/鶏/羊 (meat species), 酒/酢 (alcohol/vinegar) and
 * 乳/卵 must stay at the default cost. There is a regression test for this.
 */

const DEFAULT_COST = 1.0;

/** Pair key is order-independent. */
const COSTS = new Map<string, number>();

function key(a: string, b: string): string {
  return a < b ? `${a}${b}` : `${b}${a}`;
}

function pair(a: string, b: string, cost: number): void {
  if (a === b) return;
  COSTS.set(key(a, b), cost);
}

/** Every pair of distinct characters inside `chars` is a likely confusion. */
function group(cost: number, chars: string): void {
  const arr = [...chars];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) pair(arr[i], arr[j], cost);
  }
}

// --- kana: small vs large -----------------------------------------------------
group(0.25, 'ァア');
group(0.25, 'ィイ');
group(0.25, 'ゥウ');
group(0.25, 'ェエ');
group(0.25, 'ォオ');
group(0.25, 'ャヤ');
group(0.25, 'ュユ');
group(0.25, 'ョヨ');
group(0.25, 'ッツ');

// --- kana: voiced vs unvoiced (マヨネーズ -> マヨネース) -----------------------
group(0.3, 'ガカ');
group(0.3, 'ギキ');
group(0.3, 'グク');
group(0.3, 'ゲケ');
group(0.3, 'ゴコ');
group(0.3, 'ザサ');
group(0.3, 'ジシ');
group(0.3, 'ズス');
group(0.3, 'ゼセ');
group(0.3, 'ゾソ');
group(0.3, 'ダタ');
group(0.3, 'ヅツ');
group(0.3, 'デテ');
group(0.3, 'ドト');
group(0.3, 'バハパ');
group(0.3, 'ビヒピ');
group(0.3, 'ブフプ');
group(0.3, 'ベヘペ');
group(0.3, 'ボホポ');

// --- katakana look-alikes seen in our scan logs -------------------------------
group(0.3, 'カ力'); // カラメル -> 力メル
group(0.3, 'エ工'); // クエン酸 -> ク工酸
group(0.3, 'ロ口'); // シャロット -> シ口ット
group(0.3, 'タ夕'); // マスタード -> マス夕ード
group(0.3, 'ミ三'); // ビタミン -> ビタ三ン
group(0.3, 'ビピ'); // ビタミン -> ピタミン
group(0.3, 'ー一丨'); // long vowel vs kanji "one"

// --- kanji shape confusions seen in our scan logs -----------------------------
group(0.35, '増幹占第祐'); // 増粘剤 -> 増古剤 / 増幹 / 増占 / 管祐剤
group(0.35, '粘古枯佑'); // 粘 misread as 古
group(0.35, '椒線織報棚槻城'); // 胡椒 -> 胡線 / 胡織 / 胡報 / 胡棚 / 胡槻
group(0.4, '胡古湖故固'); // 胡 -> 古
group(0.4, '香辛平'); // 香辛料 -> 香平料
group(0.35, '葱五玉'); // 玉葱 -> 五葱
group(0.35, '瓜爪辰'); // 胡瓜 -> 爪 / 辰
group(0.35, '砂沙'); // 砂糖 -> 沙糖
group(0.35, '澱殿'); // 澱粉 -> 殿粉

// --- latin / digits -----------------------------------------------------------
group(0.2, 'O0');
group(0.2, 'o0');
group(0.2, 'l1I');

/** Substitution cost for two characters (default 1.0). */
export function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  return COSTS.get(key(a, b)) ?? DEFAULT_COST;
}

/** Pairs that must never be cheap (regression-tested). */
export const FORBIDDEN_CHEAP_PAIRS: [string, string][] = [
  ['豚', '牛'],
  ['豚', '鶏'],
  ['豚', '羊'],
  ['牛', '鶏'],
  ['酒', '酢'],
  ['乳', '卵'],
  ['砂', '塩'],
];
