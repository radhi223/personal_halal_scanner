# VALIDATION BASELINE — 110 real Japanese label images

> **This is a BASELINE (measurement), not a pass/fail gate.**
> It records what the current OCR + `extractIngredientSection` + `analyzeLayered`
> pipeline does on a real-image corpus, so later changes can be compared against
> it. No acceptance threshold is defined here; several failure classes below are
> known corpus/language issues, not pipeline bugs.

- Date: 2026-09-27 (session 4, first real-image validation run)
- Base commit: `6b6a311` (working tree also contains unrelated pre-existing edits)
- Harness: `npx tsx scripts/eval-real.ts` (PaddleOCR PP-OCRv5 mobile, same model
  and options as the app: `flatten`, `minimumConfidence=0.4`, `strategy=per-line`)
- Raw outputs (outside repo):
  - `D:/opencode/temp/eval-real-baseline.json` + `-console.txt`
  - `D:/opencode/temp/eval-real-after.json` + `-console.txt`
  - per-image raw OCR text for triage: `D:/opencode/temp/opencode/real-harvest.json`
- No git commit was made. Files edited by this run: `src/lib/rules.ts`,
  `src/data/ingredients.json`, `scripts/smoke.ts`; new file: this report.

### Methodology caveat (important)

`scripts/eval-real.ts` lists image files in the directory passed to `--dir`
**non-recursively**, while the corpus keeps images in `caa/ commons/ off/
personal/ _work/` sub-directories. The run therefore used a flattened copy of
exactly the 110 manifest images in `D:/opencode/temp/labels-flat/`
(file name = manifest path with `/` replaced by `__`, e.g.
`off__off_2303797301427_ingredients.jpg`). All 110 manifest files were found;
0 missing. The 9 non-manifest files in `_work/` (download scripts, PDFs) were
ignored.

---

## 1. Corpus composition

Counts per source from `D:/opencode/temp/labels/manifest.json` (110 entries):

| Source | Images |
|---|---|
| Open Food Facts | 68 |
| Wikimedia Commons | 19 |
| 消費者庁 (CAA) — government guide PDFs | 12 |
| food-label-db.com (食品表示ラベルナビ) | 5 |
| labeling.jp (表示ラベルDb) | 5 |
| 東京都保健医療局 — government guide PDF | 1 |
| **Total** | **110** |

By image kind (from file names + visual spot checks):

| Kind | Count | Notes |
|---|---|---|
| OFF `_ingredients` panels | 35 | the real target: ingredient-list photos |
| OFF `_front` product photos | 33 | no ingredient panel in frame |
| CAA + Tokyo guide/model pages | 13 | legal prose + example labels, **not product labels** |
| Wikimedia Commons | 19 | product shots, price tags, ukiyo-e prints, a medicine label, a wooden ruler/shrine marker — mostly not ingredient panels |
| fldb `_label` / `_product` | 3 + 2 | 3 ingredient panels, 2 product photos |
| labeling.jp | 5 | label photos (2 are OCR-hard) |

Language / scope issues inside the set:

- 5 OFF labels are **English** (e.g. California raisins `off/off_0041143029329_ingredients.jpg`).
- 1 OFF label is **Bulgarian/Romanian** (`off/off_4823077629518_ingredients.jpg`).
- 13 guide pages are government explanatory text; they are the single largest
  source of "unmatched" tokens (≈550 of 1166, ≈47%).
- Only **38 images** are true Japanese ingredient panels
  (35 OFF `_ingredients` + 3 fldb `_label`).

Consequence: **the headline aggregate is dominated by non-label images.**
Both the full-110 and the label-only-subset numbers are reported below.

---

## 2. Aggregate metrics (baseline run)

Run: `npx tsx scripts/eval-real.ts --dir D:/opencode/temp/labels-flat --out D:/opencode/temp/eval-real-baseline.json`

| Metric | All 110 images | Label-like subset (38) |
|---|---|---|
| Images processed | 110 | 38 |
| Harness failures (`ocrError`) | **0** | 0 |
| OCR ms mean / median | **1138.9 / 686.0** | 745 / 581 |
| Mean matched / unmatched / unknown per image | **5.36 / 10.60 / 1.56** | 7.2 / 7.3 / 2.0 |
| Status totals halal / haram / syubhat / unknown | **309 / 7 / 102 / 172** | 149 / 3 / 46 / 77 |

Per source (baseline):

| Source | Imgs | Mean matched/unmatched/unknown | halal | haram | syubhat | unknown | unmatched |
|---|---|---|---|---|---|---|---|
| Open Food Facts | 68 | 4.6 / 6.9 / 1.6 | 155 | 4 | 46 | 109 | 466 |
| Wikimedia Commons | 19 | 1.3 / 6.2 / 0.2 | 15 | 0 | 6 | 4 | 117 |
| 消費者庁 (CAA) | 12 | 12.9 / 39.6 / 3.0 | 84 | 3 | 32 | 36 | 475 |
| food-label-db.com | 5 | 8.4 / 4.4 / 2.0 | 26 | 0 | 6 | 10 | 22 |
| labeling.jp | 5 | 8.2 / 2.2 / 1.6 | 24 | 0 | 9 | 8 | 11 |
| 東京都保健医療局 | 1 | 13.0 / 75.0 / 5.0 | 5 | 0 | 3 | 5 | 75 |

**7 haram findings, all correct on inspection:** 豚ばら肉 + ベーコン
(`caa/caa_guide_p22.png`, example label), 豚肉 (`caa/caa_kochi_p11.png`,
`off/off_0245027104984_front.jpg`), 清酒 (`off/off_4517888131963_ingredients.jpg`),
牛脂豚脂混合油脂 (`off/off_4901002173340_ingredients.jpg`), WINE
(`off/off_0011152174754_ingredients.jpg`, English label).

### Top-40 unmatched tokens (baseline)

Tokens with no match in any layer. The top of this list is CAA legal prose, not
ingredients — see §4.

| # | token | n | # | token | n |
|---|---|---|---|---|---|
| 1 | 個別的 | 8 | 21 | Na | 4 |
| 2 | 別表 | 8 | 22 | 別表第 | 4 |
| 3 | 定義 | 8 | 23 | 別表第19 | 4 |
| 4 | 方式 | 8 | 24 | 別表第3 | 4 |
| 5 | 第20 | 8 | 25 | 别表 | 4 |
| 6 | 第3 | 8 | 26 | NET | 3 |
| 7 | 第3条 | 8 | 27 | Og | 3 |
| 8 | 規制 | 8 | 28 | WT | 3 |
| 9 | 別表第4 | 7 | 29 | く添加物>使用した添加物を | 3 |
| 10 | 第19 | 7 | 30 | 事項 | 3 |
| 11 | 第5 | 7 | 31 | 栄養強化の目的で使用される添加 | 3 |
| 12 | ■ポイント | 6 | 32 | 様式及び | 3 |
| 13 | なお | 6 | 33 | 第3条第1 | 3 |
| 14 | 第22 | 6 | 34 | ■留意点 | 2 |
| 15 | ●印 | 5 | 35 | 〇〇 | 2 |
| 16 | 上記の別表早見表での該当箇 | 5 | 36 | AND | 2 |
| 17 | 上記の別表早見表での該当箇 所 | 5 | 37 | Bi | 2 |
| 18 | 樣式及び | 5 | 38 | BY | 2 |
| 19 | 止事項 | 5 | 39 | CALIFORNIA | 2 |
| 20 | ■別表早見表 | 4 | 40 | et | 2 |

### Top-40 unknown tokens (baseline, catalog hit with no verdict)

| # | token | n | # | token | n |
|---|---|---|---|---|---|
| 1 | 加工食品 | 8 | 21 | Butter | 1 |
| 2 | 料名 | 8 | 22 | CAMEMBERT | 1 |
| 3 | INGREDIENTS | 4 | 23 | CARAMEL | 1 |
| 4 | VANILLA | 3 | 24 | char | 1 |
| 5 | BEAN | 2 | 25 | Chocolate | 1 |
| 6 | Cream | 2 | 26 | CIDER | 1 |
| 7 | また | 2 | 27 | COLOR | 1 |
| 8 | ミノ酸等 | 2 | 28 | CORNSTARCH | 1 |
| 9 | リー | 2 | 29 | Country | 1 |
| 10 | 三ノ酸等 | 2 | 30 | CREAM | 1 |
| 11 | 保存 | 2 | 31 | CRUST | 1 |
| 12 | 由来 | 2 | 32 | CUMIN | 1 |
| 13 | 酸等 | 2 | 33 | daily | 1 |
| 14 | 開封後は | 2 | 34 | EGG | 1 |
| 15 | -飽和脂肪酸 | 1 | 35 | EGGWHITES. | 1 |
| 16 | acio. | 1 | 36 | EGGYOLKPOWDER | 1 |
| 17 | ALE | 1 | 37 | EXTRACT | 1 |
| 18 | ALMOND | 1 | 38 | FILLINGS | 1 |
| 19 | Bar | 1 | 39 | food | 1 |
| 20 | butter | 1 | 40 | found | 1 |

---

## 3. Triage of failure classes

Classes are not mutually exclusive per image; counts are failure *events*
(findings or images) with one primary cause. "Remaining" = still present after
the fixes in §4.

| Class | Count (baseline) | Fixed | Remaining | Concrete examples (file) |
|---|---|---|---|---|
| OCR-GAP | 5 label images (+8 no-text/non-label images) | 0 | 13 | `off/off_3161717000510_ingredients.jpg` (raw=**0** chars on a readable curved Camembert label), `off/off_3923534028906_ingredients.jpg`, `off/off_4573356891708_ingredients.jpg`, `off/off_0207481503024_ingredients.jpg`, `commons/commons_8752933.jpg` |
| EXTRACT-GAP | 4 JP label images (+5 English labels) | 0 | 9 | `off/off_2000000106610_ingredients.jpg` (section reduced to `の一部に大豆含む）`), `off/off_4532508031157_ingredients.jpg` (first half of list lost), `personal/fldb_4901313207604_label.jpg` (starts at 香辛料), `personal/fldb_4902410315353_label.jpg` (starts at プン) |
| DATA-GAP | 0 clear items | 0 | 0 | skipped as ambiguous: 生地 (dough), 納豆 (no token measured), イ一ストフ一ド (source-dependent), セスル/スクラース (OCR garbage) |
| RULE-GAP | 13 images / 12 new verdicts | **13 images** | 0 | ミノ酸等/三ノ酸等/三酸等 (`caa/caa_kochi_p05.png`, `off/off_0245027104984_ingredients.jpg`), ソルビン酸 (`caa/caa_kochi_p11.png`), トリン (`personal/labelingjp_3502_IMG_2634_2.jpg`), 食物繊 (`off/off_4573356891708_ingredients.jpg`), ウスタ一ース (`off/off_4901002173340_ingredients.jpg`), 発風味料 (`off/off_0207481503024_ingredients.jpg`), ビ一チ (`personal/fldb_4902750702042_label.jpg`), 難消化性 ストリン (`off/off_45226731_ingredients.jpg`) |
| NOISE-OVERREACH | 61 findings / 24 label files (+196 findings / 13 guide files) | 0 | 61 (+196) | `off/off_2303797301427_ingredients.jpg` (内容量/製造者/nutrition inside section), `off/off_4549414206524_ingredients.jpg` (お問い, 工ネル), `personal/fldb_4902750702042_label.jpg` (してくたさ, 味覚喜淋式会社); guide prose: 別表×8, 定義×8 on `caa/caa_kochi_p07.png` |
| FALSE-VERDICT | 13 findings / 11 images | **3 findings / 3 images** | 10 findings / 9 images | ただし → syubhat 白だし ×5 (`caa/caa_kochi_p05/07/11/13.png`, `caa/caa_guide_p14.png`), 薬ラベル → halal ミラベル (`commons/commons_82257956.jpg`), 和生菜子/レ八口ース → halal (`commons/commons_64720072.jpg`), 加工所 → syubhat 加工酢 (`off/off_45130571_ingredients.jpg`), Asahi → syubhat だし (`off/off_4514603238112_front.jpg`); fixed: ソルビン 酸/ソルビン酸 → halal (`caa/caa_kochi_p11/15.png`), トリン removed (`personal/labelingjp_3502_IMG_2634_2.jpg`) |

### Class definitions used

- **OCR-GAP** — the image contains readable text but PaddleOCR returned empty or
  unusable text (verified by viewing the image).
- **EXTRACT-GAP** — OCR text is usable but `extractIngredientSection()` selected
  the wrong range (empty, truncated, or wrong section).
- **DATA-GAP** — a real ingredient with no curated entry/catalog name at all.
- **RULE-GAP** — a real ingredient whose keyword rule/pattern was missing (or too
  narrow), including systematic OCR variants.
- **NOISE-OVERREACH** — non-ingredient label metadata (nutrition, maker, dates,
  contact, claims, guide prose) survives into findings as matched/unmatched cards.
- **FALSE-VERDICT** — a matched verdict that looks wrong for the token.

### Notes on the counts

- OCR-GAP: the 5 label images above + 8 images with no ingredient text to read at
  all (`commons/commons_14539042.jpg` price tag, `commons/commons_26201562.jpg`
  wooden ruler/shrine marker, `commons/commons_49117799.jpg` mayo bottle front,
  `commons/commons_82257955.jpg` ukiyo-e medicine print, `commons/commons_6055256.jpg`,
  `commons/commons_82257956.jpg` medicine label, `personal/labelingjp_2526_IMG_8617_1.jpg`
  natto front, `off/off_4823077629518_ingredients.jpg` Bulgarian label).
- EXTRACT-GAP: 4 Japanese labels above + 5 English labels whose `INGREDIENTS:`
  marker is not recognized, so the fallback returns the whole nutrition panel
  (`off/off_0041143029329_ingredients.jpg` alone has 77 unmatched tokens).
- The 13 government guide pages are counted in NOISE-OVERREACH (guide prose) and
  also as an EXTRACT-GAP *corpus* issue: `extractIngredientSection()` finds the
  word 原材料 in explanatory sentences and returns legal text
  (`caa/caa_kochi_p07.png` raw=1000 → section=937, 47 unmatched).
- NOISE-OVERREACH root cause for real labels: PaddleOCR is called with
  `flatten: true`, so the whole image arrives as **one line**. The section
  extractor can only stop at newlines, so everything after 原材料名 (nutrition,
  maker, storage, contact) is kept and becomes unmatched/unknown findings.
  Fixing it belongs in `src/lib/normalize.ts` (`isLabelNoise` / line handling),
  which was out of scope for this run.
- FALSE-VERDICT root cause: curated fuzzy matching on short non-ingredient tokens
  (ただし ≈ 白だし, トリン ≈ ミリン, ソルビン酸 ≈ カルミン酸, 薬ラベル ≈ ミラベル).
  Fixing the remaining ones needs a matcher/noise guard (`src/lib/matcher.ts` /
  `src/lib/normalize.ts`), also out of scope.

---

## 4. Fixes applied

Only clear DATA-GAP / RULE-GAP items were fixed. Nothing animal/alcohol-like was
added; no new `halal` verdict can be granted to a token containing an
animal/alcohol marker. Each fix has smoke assertions (group 41). Result:
**13 images changed, 12 new verdicts (10 halal, 2 syubhat) and 3 false-syubhat
corrections**.

| # | File | Change | Why / evidence |
|---|---|---|---|
| 1 | `src/lib/rules.ts` | amino-acid rule: added `/ミノ酸/`, `/三ノ酸/`, `/三酸/` | OCR drops the leading ア of アミノ酸 (ミノ酸等) or reads ミ as 三 (三ノ酸等/三酸等). 5 findings: `caa/caa_kochi_p05.png`, `off/off_0245027104984_ingredients.jpg`, `off/off_4532508031157_ingredients.jpg`, `off/off_2000000157212_ingredients.jpg`, `personal/fldb_4901313207604_label.jpg` |
| 2 | `src/lib/rules.ts` | potassium-sorbate rule: added `/ソルビン酸/` (covers all salts) | ソルビン酸 (E200, halal preservative) was fuzzy-matching カルミン酸 (carmine, syubhat) → **false syubhat** on `caa/caa_kochi_p11.png`, `caa/caa_kochi_p15.png` |
| 3 | `src/lib/rules.ts` | dextrin rule: added **anchored** `/^トリン$/`, `/^ストリン$/`, `/^難消化性$/` | OCR splits デキストリン into `デキス トリン`; the fragment fuzzy-matched ミリン (mirin) → **false syubhat** on `personal/labelingjp_3502_IMG_2634_2.jpg`. Anchored on purpose: an unanchored `/トリン/` granted halal to OCR soup (`脱 脂粉乳デストリンク リー`), verified and guarded by a smoke test |
| 4 | `src/lib/rules.ts` | dietary-fiber rule: added `/食物繊/` | truncated 食物繊維 on `off/off_4573356891708_ingredients.jpg`; the prefix can only be 食物繊維 |
| 5 | `src/lib/rules.ts` | sauce rule: added `/ウスタ/` | ウスターソース misread with 一 for ー (`ウスタ一ース`, `off/off_4901002173340_ingredients.jpg`); stays syubhat (low), no false halal |
| 6 | `src/lib/rules.ts` | fermented-seasoning rule: added `/発風味料/` | 発酵風味料 truncated (`off/off_0207481503024_ingredients.jpg`); stays syubhat (caution direction) |
| 7 | `src/data/ingredients.json` | `exp:ビート` names: added `ビ一チ`, `ビ一ト` | ビート OCR variant (`personal/fldb_4902750702042_label.jpg`); beet is plant → halal, same as the existing コーヒ一 alias precedent |

Deliberately **not** fixed: 生地 (ambiguous prepared component), 納豆 (no measured
token; fermented-soy caution like miso), イ一ストフ一ド (dough conditioner, not
clearly halal), セスル/スクラース/カツ才工キス/ガ 才/ウコ (random OCR garbage),
凝固/消泡 truncations (an unanchored pattern would grant halal to sentence
fragments such as `これはたんぱく質が凝固し` in the catalog).

Smoke tests added: group 41 — 41 assertions, including the two false-verdict
non-regressions (カルミン酸 stays syubhat, ミリン stays syubhat), the anchored-
fragment guard (`クリンゲルトリン NOT halal`), and the rule-order guard
(`リン酸三ナトリウム`/`クエン酸三ナトリウム` still match the earlier
phosphate/citric rules).

---

## 5. Before / after deltas

### Aggregate (same 110 images, same OCR cache/run options)

| Metric | Baseline | After | Δ |
|---|---|---|---|
| Images / harness failures | 110 / 0 | 110 / 0 | — |
| OCR ms mean / median | 1138.9 / 686.0 | 1081.3 / 686.5 | run-to-run OCR noise |
| Mean matched | 5.36 | 5.36 | 0.00 |
| Mean unmatched | 10.60 | 10.56 | **−0.04** |
| Mean unknown | 1.56 | 1.48 | **−0.08** |
| Status halal | 309 | **319** | **+10** |
| Status haram | 7 | 7 | 0 |
| Status syubhat | 102 | **101** | **−1** |
| Status unknown (catalog) | 172 | **163** | **−9** |
| Unmatched findings (total) | 1166 | 1162 | **−4** |

### Per source (matched / unmatched / unknown means; status totals)

| Source | m/u/k before | m/u/k after | halal | syubhat | unknown |
|---|---|---|---|---|---|
| Open Food Facts | 4.6 / 6.9 / 1.6 | 4.6 / 6.8 / 1.5 | 155 → **160** | 46 → **48** | 109 → **102** |
| 消費者庁 (CAA) | 12.9 / 39.6 / 3.0 | 12.9 / 39.6 / 2.9 | 84 → **87** | 32 → **30** | 36 → **35** |
| food-label-db.com | 8.4 / 4.4 / 2.0 | 8.6 / 4.2 / 1.8 | 26 → **28** | 6 → 6 | 10 → **9** |
| labeling.jp | 8.2 / 2.2 / 1.6 | 8.0 / 2.2 / 1.6 | 24 → 24 | 9 → **8** | 8 → 8 |
| Wikimedia Commons | 1.3 / 6.2 / 0.2 | unchanged | 15 | 6 | 4 |
| 東京都保健医療局 | 13.0 / 75.0 / 5.0 | unchanged | 5 | 3 | 5 |

(Label-like subset: mean m/u/k 7.2/7.3/2.0 → 7.3/7.2/1.8; halal 149 → 156,
unknown 77 → 69, syubhat 46 → 48, haram 3.)

### Per-token changes (13 images)

| Image | Before → after |
|---|---|
| `caa__caa_kochi_p05.png` | ミノ酸等 unknown(catalog) → **halal (rule:amino-acid)** |
| `caa__caa_kochi_p11.png` | ソルビン 酸 syubhat(carmine) → **halal (rule:potassium-sorbate)** |
| `caa__caa_kochi_p15.png` | ソルビン酸 syubhat(carmine) → **halal (rule:potassium-sorbate)** |
| `off__off_0207481503024_ingredients.jpg` | 発風味料 unknown(catalog) + `国内 一 発風味料` unmatched → **syubhat (rule:fermented-seasoning)** (collapse keeps one) |
| `off__off_0245027104984_ingredients.jpg` | 三ノ酸等 unknown(catalog) → **halal (rule:amino-acid)** |
| `off__off_2000000157212_ingredients.jpg` | 三酸等 unmatched → **halal (rule:amino-acid)** |
| `off__off_45226731_ingredients.jpg` | 難消化性 ストリン + ストリン unknown(catalog) + 難消化性 unmatched → **halal (rule:dextrin)** (collapse keeps one) |
| `off__off_4532508031157_ingredients.jpg` | 三ノ酸等 unknown(catalog) → **halal (rule:amino-acid)** |
| `off__off_4573356891708_ingredients.jpg` | 食物繊 unknown(catalog) → **halal (rule:dietary-fiber)** |
| `off__off_4901002173340_ingredients.jpg` | ウスタ一ース unknown(catalog) → **syubhat (rule:sauce)** |
| `personal__fldb_4901313207604_label.jpg` | ミノ酸等 unknown(catalog) → **halal (rule:amino-acid)** |
| `personal__fldb_4902750702042_label.jpg` | ビ一チ unmatched → **halal (exp:ビート)** |
| `personal__labelingjp_3502_IMG_2634_2.jpg` | トリン syubhat(mirin) removed; the full `デキス トリン` segment was already halal via /デキストリン/, so no new finding survives collapse |

No token moved to `haram`; no token moved from `halal`/`haram` to a weaker
status except the three false-verdict corrections listed above.

---

## 6. Remaining biggest failure causes (with evidence)

1. **Corpus composition skews every aggregate.** 13 government guide pages
   (`caa/caa_kochi_p07.png`: 47 unmatched findings; `caa/tokyo_hyouji_p02.png`:
   75), 33 `_front` photos, 2 `_product` photos, and 19 Commons images that are
   often not labels at all (`commons/commons_26201562.jpg` = wooden ruler +
   shrine marker; `commons/commons_14539042.jpg` = price tag;
   `commons/commons_82257955.jpg` = ukiyo-e medicine print) together contribute
   most of the 1162 unmatched tokens. Split these out before reading coverage
   numbers.
2. **OCR-GAP on genuinely readable labels.** `off/off_3161717000510_ingredients.jpg`
   is a curved Camembert label where PaddleOCR returns **0 characters**.
   `off/off_3923534028906_ingredients.jpg` and
   `off/off_4573356891708_ingredients.jpg` return 80 chars of unusable text;
   `off/off_0207481503024_ingredients.jpg` (raw=100) is half-cropped and garbled;
   `commons/commons_8752933.jpg` (raw=245) is mostly garbage.
3. **EXTRACT-GAP from OCR reading order.** The `原材料名` marker is read
   *mid-list*, so the section drops the first ingredients:
   `off/off_4532508031157_ingredients.jpg` loses いか/砂糖/食塩/乳糖/醸造酢/
   還元水飴/ソルビトール; `personal/fldb_4901313207604_label.jpg` loses
   うるち米/植物油脂/食塩/魚介エキス/カツオ節粉末; `personal/fldb_4902410315353_label.jpg`
   loses ~14 items including 小麦粉/マヨネーズ/チーズ/卵/ショートニング.
   `off/off_2000000106610_ingredients.jpg` reduces a full list to
   `の一部に大豆含む）` because the only `原材料` occurrence is inside the
   allergen note. English labels (`off/off_0041143029329_ingredients.jpg`,
   77 unmatched) fail on the unsupported `INGREDIENTS:` marker.
4. **NOISE-OVERREACH: 61 metadata findings on 24 label files** because
   `flatten: true` makes the whole label one line, so the section runs past the
   ingredients into nutrition/maker/contact: `off/off_2303797301427_ingredients.jpg`
   (内容量/消賛期限/製造者/栄養成分 in section), `off/off_4549414206524_ingredients.jpg`
   (お問い, 工ネル, トップバリュお客さまサービス係),
   `personal/fldb_4902750702042_label.jpg` (してくたさ, 味覚喜淋式会社).
   Fix location is `src/lib/normalize.ts` (out of scope for this run).
5. **FALSE-VERDICT from fuzzy matching non-ingredient tokens.** ただし →
   syubhat 白だし on 5 images (`caa/caa_kochi_p05/07/11/13.png`,
   `caa/caa_guide_p14.png`); 薬ラベル → halal ミラベル
   (`commons/commons_82257956.jpg`); 和生菜子 → halal 和生菓子 and
   レ八口ース → halal レハロース (`commons/commons_64720072.jpg`);
   加工所 → syubhat 加工酢 (`off/off_45130571_ingredients.jpg`);
   Asahi → syubhat だし (`off/off_4514603238112_front.jpg`). The three
   high-impact ones (ソルビン酸→carmine ×2, トリン→mirin) were fixed here; the
   rest need a noise/fuzzy guard in `matcher.ts`/`normalize.ts`.
6. **Catalog-unknown OCR fragments clutter results** (`料名`×8,
   `加工食品`×8, `リー`×2, `酸等`×2, `保存`×2, `由来`×2). These are
   "belum ditinjau" cards, not wrong verdicts, but they make real labels look
   worse than they are. Same fix location as #4.
7. **English-label content is out of scope but still counted**
   (`off/off_0041143029329_ingredients.jpg` alone: 77 unmatched tokens of
   nutrition/marketing text).

---

## 7. Verification commands (before → after)

| Command | Baseline | After fixes |
|---|---|---|
| `npx tsc --noEmit` | clean | **clean** |
| `npm run smoke` | 40 groups, ALL PASS | **41 groups, 669 PASS lines, ALL PASS** |
| `npx tsx scripts/gaps.ts` | 87.7% covered / 12.2% noise / 0.1% unknown / 6 unknown tokens | **unchanged: 87.7 / 12.2 / 0.1 / 6** |
| `npx tsx scripts/eval.ts` | 99.8 / 92.2 / 83.8, assertions 19/19 | **99.8 / 92.2 / 83.9, assertions 19/19** |

(The corpus-weighted `gaps.ts` numbers do not move because the fixed tokens are
not in the OFF top-800 list; the real-image deltas in §5 are the measurable
effect.)

---

## 8. Top-5 things a human should look at

1. **`off/off_3161717000510_ingredients.jpg`** — a perfectly readable curved
   Camembert ingredient list where OCR returns **0 characters**. This is the
   single worst miss; curved/small text preprocessing is the likely lever.
2. **The 13 government guide pages** (`caa/caa_kochi_p05..p15.png`,
   `caa/caa_guide_p14/15/22/23.png`, `caa/tokyo_hyouji_p02.png`) — they are not
   product labels, yet they contribute ~47% of all unmatched tokens and 2 of the
   false verdicts. Decide whether they belong in the label metrics at all.
3. **`off/off_4532508031157_ingredients.jpg`** — reading order puts 原材料名 in
   the middle of the list, so half the ingredients (いか/砂糖/食塩/乳糖/醸造酢/
   還元水飴/ソルビトール) are never evaluated.
4. **`personal/fldb_4902410315353_label.jpg`** — section starts at プン; the 14
   leading ingredients (小麦粉/マヨネーズ/チーズ/卵/ショートニング/乳化剤…) are
   silently skipped, including source-dependent ones.
5. **`ただし` → syubhat 白だし on `caa/caa_kochi_p05.png` (and 4 more images)** —
   a common conjunctive word gets a food verdict via fuzzy matching; needs a
   noise/guard fix in `matcher.ts`/`normalize.ts`.

---

## 9. Label-only baseline (kind=label)

> **BASELINE — measurement, not a pass/fail gate.**
> This section records the first *label-only* corpus metrics, after the harness
> learned to separate product ingredient panels from government guide pages and
> other non-label images. Compare future changes against these numbers, not
> against the mixed-110 aggregate in §2.

- Date: 2026-09-27 (session 5)
- Base commit: `6b6a311` (working tree has the uncommitted §4 fixes **plus**
  concurrent fix42 edits that landed at ~15:56–15:57 before the OCR runs:
  `src/lib/matcher.ts` short/non-food fuzzy guard, `src/lib/normalize.ts`
  `NOISE_EXACT` additions, `scripts/smoke.ts` group 42. Those files were changed
  by another process, not by this run; this run only edited `scripts/eval-real.ts`
  and this report. The numbers below reflect fix42.)
- No git commit was made. Files edited by this run: `scripts/eval-real.ts`,
  this report. New artifacts (outside repo):
  `D:/opencode/temp/labels/manifest.backup.json`,
  `D:/opencode/temp/labels/manifest.with-kind.json`,
  `D:/opencode/temp/eval-real-kind-all.json` + `-console.txt`,
  `D:/opencode/temp/eval-real-kind-label.json` + `-console.txt`.

### 9.1 Harness fixes in this run

1. **Recursive scan (fixes the flatten workaround).** `scripts/eval-real.ts`
   now walks `--dir` depth-first, so `--dir D:/opencode/temp/labels` works
   directly; the previous run had to stage a hand-flattened copy in
   `D:/opencode/temp/labels-flat/`. File keys are relative paths with `/`
   (`off/off_...jpg`), which is exactly the manifest `file` field.
2. **Explicit `kind` classifier** (`label` / `guide` / `unknown`), documented in
   the script header and overridable per entry: a `kind` field on a manifest
   entry wins over the heuristic. Rules:
   - `guide` — source folder `caa/` or `tokyo/` (消費者庁 / 東京都保健医療局),
     or any file name containing `guide`.
   - `label` — label-source family (`off` / `commons` / `fldb` / `labelingjp`)
     whose base name contains `ingredient` / `label` / `back` / `裏` / `_ura` /
     `ura_`. Covers OFF `*_ingredients`, fldb `*_label`, all `labelingjp_*`.
   - `unknown` — everything else (OFF `*_front`, fldb `*_product`, Commons).
3. **`--kind label|guide|all` filter** (default `all`) selects which images are
   OCR'd; per-kind counts are always printed, per-kind aggregates only for the
   kinds processed. JSON keeps the old `images` + `aggregate` shape and adds
   `kindFilter`, `kindCounts`, `sourceCounts`, `byKind`.
4. **Non-destructive manifest annotation.** `--write-manifest-kind` emitted
   `manifest.with-kind.json` (110 entries; label 43 / guide 13 / unknown 54) as
   a **new** file. `manifest.json` was backed up to `manifest.backup.json`
   before the run and re-verified afterwards: SHA-256 unchanged
   (`FF4470CC…27BC91`).
5. **Runs:**
   `npx tsx scripts/eval-real.ts --dir D:/opencode/temp/labels --kind all --write-manifest-kind --out D:/opencode/temp/eval-real-kind-all.json`
   `npx tsx scripts/eval-real.ts --dir D:/opencode/temp/labels --kind label --out D:/opencode/temp/eval-real-kind-label.json`
   Corpus found: 110 images, 0 missing, 43 selected by `--kind label`.

### 9.2 Per-kind counts (classified corpus, 110)

| Kind | Count | Composition |
|---|---|---|
| `label` | **43** | 35 OFF `_ingredients` + 3 fldb `_label` + 5 labeling.jp |
| `guide` | **13** | 12 CAA (`caa_guide_*`, `caa_kochi_*`) + 1 Tokyo (`tokyo_hyouji_p02`) |
| `unknown` | **54** | 33 OFF `_front` + 19 Commons + 2 fldb `_product` |
| **Total** | **110** | |

### 9.3 Label-only aggregate (kind=label, 43 images)

Run: `--kind label`, `D:/opencode/temp/eval-real-kind-label.json`

| Metric | Value |
|---|---|
| Images processed | **43** |
| Harness failures (`ocrError`) | **0** |
| OCR ms mean / median | **1211.7 / 971.0** |
| Mean matched / unmatched / unknown per image | **7.05 / 6.86 / 1.60** |
| Status totals halal / haram / syubhat / unknown | **176 / 3 / 55 / 69** |
| Unmatched findings (total) | **295** |

Consistency check: the label subset inside the same-day `--kind all` pass gives
the identical m/u/k `7.05 / 6.86 / 1.60` and identical status totals; only OCR
wall time differs (mean 1279.3 / median 1021.0 ms) because the all pass was
slower on this machine at that moment.

Per source (label-only):

| Source | Imgs | OCR ms mean | Mean matched/unmatched/unknown | halal | haram | syubhat | unknown(catalog) | Unmatched total |
|---|---|---|---|---|---|---|---|---|
| Open Food Facts | 35 | 1239.7 | 6.31 / 7.74 / 1.51 | 124 | 3 | 41 | 53 | 271 |
| labeling.jp (表示ラベルDb) | 5 | 790.2 | 8.00 / 2.20 / 1.60 | 24 | 0 | 8 | 8 | 11 |
| food-label-db.com (食品表示ラベルナビ) | 3 | 1587.0 | 14.00 / 4.33 / 2.67 | 28 | 0 | 6 | 8 | 13 |

### 9.4 Top-40 unmatched tokens (label-only)

Counts are 1–2 per token; the tail is dominated by English-label OCR fragments.

| # | token | n | # | token | n |
|---|---|---|---|---|---|
| 1 | in | 2 | 2 | Na | 2 |
| 3 | SOY | 2 | 4 | .C | 1 |
| 5 | .fbeto | 1 | 6 | .fbeto y V | 1 |
| 7 | <ん液 | 1 | 8 | ■製品表面の黒い点は | 1 |
| 9 | A. | 1 | 10 | A. 1 | 1 |
| 11 | ACIDARTIFICIALLAVOR | 1 | 12 | acio. | 1 |
| 13 | acm.Tcumouoll | 1 | 14 | acm.Tcumouoll vitann Bi jtmamin mononiraiej | 1 |
| 15 | advice. | 1 | 16 | Als | 1 |
| 17 | AN | 1 | 18 | anaien | 1 |
| 19 | AND | 1 | 20 | ANDMAY | 1 |
| 21 | aooeonoig | 1 | 22 | APAN | 1 |
| 23 | APAN ASAH SOFTDRINKSCO.LID MANUFACTURER | 1 | 24 | ARE | 1 |
| 25 | ASAH | 1 | 26 | ASH | 1 |
| 27 | ASH SEDRASE.SOMDAKU TOKYO | 1 | 28 | balaing soda odfum a pyroprecphate. monocacium phospnel. whey elowG rccsa WNEAT.PLANUT | 1 |
| 29 | BEAN | 1 | 30 | Bi | 1 |
| 31 | BMEAA | 1 | 32 | BMEAA a | 1 |
| 33 | butter iroasted peanutss sugar | 1 | 34 | BY | 1 |
| 35 | CA93631U.S | 1 | 36 | CALIFORNIA | 1 |
| 37 | calones | 1 | 38 | CARBONATED | 1 |
| 39 | CE07 | 1 | 40 | CERTIFED | 1 |

### 9.5 Top-40 unknown tokens (label-only)

"Unknown" = catalog hit with no verdict yet.

| # | token | n | # | token | n |
|---|---|---|---|---|---|
| 1 | INGREDIENTS | 4 | 2 | リー | 2 |
| 3 | 酸等 | 2 | 4 | butter | 1 |
| 5 | CORNSTARCH | 1 | 6 | EGG | 1 |
| 7 | EGGWHITES. | 1 | 8 | EGGYOLKPOWDER | 1 |
| 9 | EXTRACT | 1 | 10 | GRAPESTEM | 1 |
| 11 | HIGH FRUCTOSECORN SYRUP | 1 | 12 | LACTOSE | 1 |
| 13 | MILK | 1 | 14 | peanutss | 1 |
| 15 | Protein | 1 | 16 | RAISINS. | 1 |
| 17 | SEAWEED | 1 | 18 | serving | 1 |
| 19 | SESAMESEED | 1 | 20 | SOYBEAN | 1 |
| 21 | SOYFLOUR | 1 | 22 | VANILLA | 1 |
| 23 | WATER.SUGAR | 1 | 24 | WHEAT | 1 |
| 25 | whey | 1 | 26 | アメリカまたはカナダ | 1 |
| 27 | イ一ストフ一ド | 1 | 28 | ウコ X ン | 1 |
| 29 | お問い | 1 | 30 | お問い合せ先 | 1 |
| 31 | お問合せ先 | 1 | 32 | キス | 1 |
| 33 | しい | 1 | 34 | しい たた | 1 |
| 35 | ス ビア | 1 | 36 | スルフムK | 1 |
| 37 | セスル | 1 | 38 | そだ節 | 1 |
| 39 | たんぱ<質 | 1 | 40 | たんぱく質脂 | 1 |

### 9.6 Interpretation vs the mixed corpus

Same-day `--kind all` pass (single OCR pass, directly comparable):

| Metric | All 110 | Label only (43) | Guide (13) | Other non-label (54) |
|---|---|---|---|---|
| OCR ms mean / median | 1618.1 / 1193.5 | **1211.7 / 971.0** | 4042.7 / 3801.0 | 1304.2 / 1106.5 |
| Mean matched | 4.95 | **7.05** | 11.62 | 1.69 |
| Mean unmatched | 10.31 | **6.86** | 38.38 | 6.30 |
| Mean unknown | 1.22 | **1.60** | 2.23 | 0.67 |
| Status halal / haram / syubhat / unknown | 312 / 7 / 92 / 134 | **176 / 3 / 55 / 69** | 92 / 3 / 27 / 29 | 44 / 1 / 10 / 36 |
| Unmatched findings total | 1134 | **295 (26.0%)** | 499 (44.0%) | 340 (30.0%) |

Against the §2 mixed baseline (separate pass: 5.36 / 10.60 / 1.56, status
309 / 7 / 102 / 172, unmatched total 1166) the label-only subset changes the
headline as follows:

- **Mean unmatched drops from 10.31 → 6.86 (−33%)** and mean matched rises from
  4.95 → 7.05 (+42%). 13 guide pages are 11.8% of images but **44% of all
  unmatched findings**; removing them (and 54 non-label photos) is what makes
  the metric meaningful.
- **Verdict mix is stable**: label-only halal share of matched findings is
  176/303 = **58.1%**, vs 312/545 = 57.2% mixed; catalog-unknown share is 22.8%
  vs 24.6%. The guide/other images mostly added *unmatched* noise, not verdicts.
- **OCR cost collapses**: guide pages are big prose pages (raw 585–2018 chars,
  2.4–6.4 s each); label-only mean OCR is 1211.7 ms, the label corpus being
  mostly small panel photos.
- **The residual label-only failure mix is now visible**: English-label OCR
  shredding (2 images = 127 of 295 unmatched, 43%), a few Japanese extract/OCR
  gaps, and label-noise overreach from `flatten: true`. It is no longer
  dominated by legal prose (`別表`, `第3条`, `定義`, `方式` disappear from the
  label-only top-40 entirely).

Rule fix (fix42) caveat: this session's all-pass gives 4.95 / 10.31 / 1.22 and
status 312 / 7 / 92 / 134, vs §2's 5.36 / 10.60 / 1.56 and 309 / 7 / 102 / 172.
The gap is explained by fix42 (short/ASCII fuzzy guard + `NOISE_EXACT`), which
removed false/boilerplate findings (guide tokens such as ただし/定義/別表 and
brand fragments such as Asahi) after §2 was written; a smaller run-to-run OCR
component may also exist. The label-only numbers above are internally consistent
because mixed and label came from the same pass and the same code revision.

### 9.7 Top-10 worst label images by unmatched count

| # | File | Unmatched | Matched | Unknown | Raw / section chars | Note |
|---|---|---|---|---|---|---|
| 1 | `off/off_0041143029329_ingredients.jpg` | **82** | 8 | 5 | 955 / 955 | English California-raisins label; `INGREDIENTS:` marker unsupported, whole nutrition panel kept |
| 2 | `off/off_0079783406125_ingredients.jpg` | **45** | 7 | 4 | 455 / 455 | English crackers label; nutrition text in section |
| 3 | `off/off_0043695933635_ingredients.jpg` | **10** | 3 | 2 | 119 / 119 | English Hot Pockets; short garbled panel |
| 4 | `off/off_4573356891708_ingredients.jpg` | **10** | 4 | 1 | 80 / 80 | heavily truncated Japanese panel |
| 5 | `off/off_4514603345117_ingredients.jpg` | **9** | 0 | 0 | 65 / 65 | French coffee label; no match at all |
| 6 | `off/off_4549414206524_ingredients.jpg` | **9** | 8 | 3 | 252 / 226 | noise overreach (お問い, 工ネル, contact lines) |
| 7 | `off/off_4640001733512_ingredients.jpg` | **9** | 0 | 0 | 68 / 68 | Russian yogurt label |
| 8 | `off/off_0074601176075_ingredients.jpg` | **8** | 4 | 3 | 98 / 98 | mixed JP/EN ramune label |
| 9 | `off/off_3923534028906_ingredients.jpg` | **8** | 5 | 1 | 80 / 80 | known OCR-GAP (§3) |
| 10 | `off/off_2000000157212_ingredients.jpg` | **7** | 3 | 0 | 65 / 51 | truncated section |

Not in this list but still the worst label miss: `off/off_3161717000510_ingredients.jpg`
(curved Camembert) returns **raw=0 chars → 0 unmatched**, so ranking by
unmatched hides it. Of 43 label images, 5 have `unmatched ≥ 8` and 2 English
labels account for 127/295 (43%) of all label-only unmatched findings.

### 9.8 Verification commands (this run)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **clean** |
| `npm run smoke` | **42 groups, 720 PASS lines, 0 FAIL — ALL PASS** (unchanged by harness edits) |
| `--kind all` on `D:/opencode/temp/labels` | 110 images, recursive scan, 0 harness failures |
| `--kind label` on `D:/opencode/temp/labels` | 43 images, 0 harness failures |
| `manifest.json` SHA-256 before/after | `FF4470CC3085DE39BCA3A4DB688B5E8ACC03CBD863B8378DC28FC46A6027BC91` (unchanged) |

Next iteration should target, in order: (1) English-label `INGREDIENTS:` marker /
scope-out handling, (2) the 5 zero/low-OCR Japanese labels, (3) section
truncation on the reading-order cases listed in §6, (4) `flatten: true` noise
overreach in `normalize.ts`.
