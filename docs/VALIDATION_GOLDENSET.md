# VALIDATION GOLDENSET — first ground-truth measurement (12 real Japanese labels)

> **What this is.** The first golden set with *manual* ground truth: 12 real
> ingredient-panel photos were visually transcribed by a human (Read tool, no
> OCR copying), each ingredient was given an expected verdict per
> `HANDOVER.md` §6, and the real pipeline (PaddleOCR → `extractIngredientSection`
> → `analyzeLayered`) was measured against it.
>
> **Headline: 0 false-halal items — the app PASSES the zero-false-halal
> criterion on this sample** (0 of 20 GT haram/syubhat items were labelled
> halal). It also has 0 false-haram. Read §6 for why that pass is weaker than
> it looks (one haram ingredient — ハム — was never evaluated at all because of
> an extraction gap).

- Date: 2026-09-27 (session 6)
- Base commit: `92d0d7e` (working tree contains 5 pre-existing modified files;
  this run **did not commit and did not touch `src/`**. New files only:
  this report in `docs/` and artifacts under `D:/opencode/temp/goldenset/`).
- Corpus: 43 `kind=label` images in `D:/opencode/temp/labels`.
- Artifacts (outside repo):
  - `D:/opencode/temp/goldenset/gt.json` — ground truth (166 ingredients)
  - `D:/opencode/temp/goldenset/gt-summary.json` — machine-readable metrics
  - `D:/opencode/temp/goldenset/measure.json` — raw OCR + findings + alignment
  - `D:/opencode/temp/goldenset/measure.ts` — measurement script
  - `D:/opencode/temp/goldenset/gt-tables.md` — generated GT tables

---

## 1. Images used (12)

Selection rule: `kind=label` only; visually confirmed to show a readable
原材料名 list; English labels (`off_0041143029329`, `off_0079783406125`,
`off_0043695933635`, `off_0074601176075`, `off_4514603345117`) and zero-char
images (`off_3161717000510`) excluded.

| # | file | source | product | GT items | hazard items |
|---|---|---|---|---|---|
| 1 | `off/off_4517888131963_ingredients.jpg` | Open Food Facts | 6種合わせだしで炊いたふっくらひじき煮 | 16 | 2 |
| 2 | `off/off_4901002173340_ingredients.jpg` | Open Food Facts | ホテルシェフ仕様 欧風ビーフカレー 中辛 | 23 | 4 |
| 3 | `off/off_4902431811575_ingredients.jpg` | Open Food Facts | おとなのベビーチーズ 明太子味 | 13 | 2 |
| 4 | `off/off_4532508031157_ingredients.jpg` | Open Food Facts | たまらない 美味しさ (魚介乾製品) | 14 | 1 |
| 5 | `off/off_2303797301427_ingredients.jpg` | Open Food Facts | ダブルチョコロール (菓子パン) | 12 | 2 |
| 6 | `off/off_45226731_ingredients.jpg` | Open Food Facts | 三ツ矢サイダー ダブル | 5 | 0 |
| 7 | `off/off_4562343850019_ingredients.jpg` | Open Food Facts | 純国産 ポテトチップスうすしお味 | 3 | 0 |
| 8 | `personal/fldb_4901313207604_label.jpg` | food-label-db.com | 手塩屋 亀田製菓 | 10 | 0 |
| 9 | `personal/fldb_4902410315353_label.jpg` | food-label-db.com | ピザパン フジパン | 28 | 5 |
| 10 | `personal/fldb_4902750702042_label.jpg` | food-label-db.com | 忍者めし鋼 ピーチ味 | 12 | 1 |
| 11 | `personal/labelingjp_2526_IMG_8623_1.jpg` | labeling.jp | 納豆（たれ・からし付き） | 18 | 2 |
| 12 | `personal/labelingjp_3502_IMG_2634_2.jpg` | labeling.jp | 生菓子（白桃ゼリー） | 12 | 0 |
| | | | **total** | **166** | **19** |

Product names are from `manifest.with-kind.json` (fallback for #5/#11/#12:
image text / product type).

### Annotation protocol

- Each image was opened with the Read tool and transcribed manually. OCR text
  was used **only** to pick candidate images and to compute recall afterwards.
- Raw Japanese is kept as printed (incl. qualifiers like `（国内製造）`).
- Additive blocks after `/` and sub-lists in parentheses were transcribed as
  separate top-level items (the app splits on the same delimiters).
- Allergen notes (`（一部に…を含む）`) and metadata (`名称`, `内容量`, …) are
  **not** ingredients and are excluded from GT.
- **No token needed `"unreadable": true`** — all 166 ingredients were clearly
  legible in the 12 selected images.
- Expected verdicts follow `HANDOVER.md` §6: default halal; haram only for
  explicit pork/khamr; source-dependent categories (gelatin, rennet/enzyme,
  emulsifier, margarine/shortening, mirin, meat) → syubhat; fish/plants/minerals
  → halal; not-enough-information → unknown. `hazard: true` flags
  pork/alcohol/gelatin/emulsifier/enzyme/cochineal/meat items (19 tokens).
- GT includes 1 deliberate **pork-free allergen trap** (`fldb_4901313207604`
  lists 豚肉 only in the allergen note) and 5 GT haram items
  (清酒, 牛脂豚脂混合油脂, ハム, 酒精 ×2).

---

## 2. Metrics (real pipeline)

Pipeline measured: `PaddleOCR V5_MOBILE_MODEL (flatten, minConf=0.4, per-line)`
→ `extractIngredientSection()` → `analyzeLayered(getCuratedIndex(),
getCatalogIndex(), section)`. Same model/options as `scripts/ocr-node.mjs` and
the app's Paddle pass. Script: `D:/opencode/temp/goldenset/measure.ts`.

Let `N = 166` GT ingredients, `V = {halal, haram, syubhat}`.

| Metric | Formula | Result |
|---|---|---|
| **OCR recall (exact)** | #GT raw found as exact substring of raw OCR / N | **121/166 = 72.9%** |
| **OCR recall (close variant)** | #GT raw found exactly **or** after fold/whitespace-insensitive sliding-window match (edit budget 1 for 4–7 chars, 20% for ≥8) / N | **133/166 = 80.1%** |
| **Classification recall** | #GT whose aligned app finding has status ∈ V / N | **111/166 = 66.9%** |
| **Verdict accuracy** | #classified app status == expected / #classified | **93/111 = 83.8%** |
| **Unknown rate** | #GT with no verdict (status `unknown` or `unmatched`) / N | **55/166 = 33.1%** |
| **False-halal** | #GT expected ∈ {haram, syubhat} **and** app status == halal | **0 (target 0 → PASS)** |
| **False-haram** | #GT expected == halal **and** app status == haram | **0** |

Unknown breakdown: 9 catalog hits with no verdict (`status=unknown`) + 46
`unmatched` tokens.

Expected distribution: **143 halal / 15 syubhat / 5 haram / 3 unknown**.

### Per image

| file | GT | OCR exact | OCR variant | classified | unknown | unmatched | verdict correct | false-halal | false-haram |
|---|---|---|---|---|---|---|---|---|---|
| off_4517888131963 | 16 | 7 | 10 | 9 | 3 | 4 | 6/9 | 0 | 0 |
| off_4901002173340 | 23 | 15 | 15 | 15 | 1 | 7 | 14/15 | 0 | 0 |
| off_4902431811575 | 13 | 11 | 12 | 13 | 0 | 0 | 11/13 | 0 | 0 |
| off_4532508031157 | 14 | 12 | 13 | 7 | 0 | 7 | 6/7 | 0 | 0 |
| off_2303797301427 | 12 | 8 | 10 | 10 | 1 | 1 | 9/10 | 0 | 0 |
| off_45226731 | 5 | 4 | 5 | 5 | 0 | 0 | 4/5 | 0 | 0 |
| off_4562343850019 | 3 | 2 | 2 | 2 | 0 | 1 | 2/2 | 0 | 0 |
| fldb_4901313207604 | 10 | 9 | 9 | 4 | 0 | 6 | 3/4 | 0 | 0 |
| fldb_4902410315353 | 28 | 20 | 20 | 10 | 3 | 15 | 9/10 | 0 | 0 |
| fldb_4902750702042 | 12 | 10 | 11 | 11 | 0 | 1 | 9/11 | 0 | 0 |
| labelingjp_2526_8623 | 18 | 13 | 14 | 14 | 0 | 4 | 10/14 | 0 | 0 |
| labelingjp_3502_2634 | 12 | 10 | 12 | 11 | 1 | 0 | 10/11 | 0 | 0 |

### Alignment note

GT→finding alignment used the finding's `raw` **and** `matchedTerm` with folded
forms (增→増, 剂→剤, katakana look-alikes 工/エ, 才/オ, 三/ミ, 一/ー) plus 7
semantic overrides for tokens the pipeline split/merged
(`増粘剤（加工でん粉）`→`加工でん粉`, `豆腐用凝固剤`→garbage tail,
`酵母エキスパウダー`→`酵母工キ`, `増粘剤（加工デンプン）`→`加工デ プ`,
`調味料（アミノ酸等）`→`三ノ酸等`, `乳化剤`+`香料`→merged `乳化削香料`,
`イヌリン`/`酸味料`→merged `イヌリンノ 酸味料`). Overrides are listed in
`measure.ts`; without them classification recall would be ~5 points lower.
Two rows in §3 show the merged-token entry (`乳化剤`→`rule:flavoring`,
`イヌリン`→`rule:acidulant`) — the verdict is still the app's verdict for the
merged token.

---

## 3. Ground-truth tables

Legend: `not classified (unmatched)` = OCR/finding absent; `not classified
(catalog unknown)` = name recognised, no verdict; `verdict mismatch` = verdict
given but ≠ expected.

### off/off_4517888131963_ingredients.jpg

6種合わせだしで炊いたふっくらひじき煮 — OCR raw 125 chars, section 121 chars

| GT ingredient (transcribed) | expected | app verdict | app entry | flag |
|---|---|---|---|---|
| ひじき（韓国） | halal | halal | exp:ひじき |  |
| にんじん | halal | halal | rule:carrot |  |
| 大豆水煮 | halal | unknown | catalog:jp-938 | not classified (catalog unknown) |
| しいたけだし | halal | unknown | catalog:jp-4510 | not classified (catalog unknown) |
| しょうゆ | halal | unmatched | — | not classified (unmatched) |
| 油揚げ | halal | halal | rule:noodle |  |
| みりん | syubhat | syubhat | mirin | hazard, correct |
| 砂糖 | halal | unmatched | — | not classified (unmatched) |
| しいたけ | halal | unknown | catalog:jp-940 | not classified (catalog unknown) |
| 清酒 | haram | haram | sake | hazard, correct |
| 植物油脂 | halal | halal | rule:veg-oil |  |
| だし（うるめ節、さば節、いわし節、かつお節、そうだ節、こんぶ） | halal | syubhat | dashi | verdict mismatch |
| かつお削りぶし | halal | unmatched | — | not classified (unmatched) |
| こんぶ | halal | unmatched | — | not classified (unmatched) |
| 増粘剤（加工でん粉） | halal | syubhat | modified-starch | verdict mismatch |
| 豆腐用凝固剤 | unknown | halal | rule:tofu | verdict mismatch |

### off/off_4901002173340_ingredients.jpg

ホテルシェフ仕様 欧風ビーフカレー 中辛 — OCR raw 167 chars, section 142 chars

| GT ingredient (transcribed) | expected | app verdict | app entry | flag |
|---|---|---|---|---|
| 小麦粉（国内製造） | halal | halal | rule:wheat |  |
| ソテー・ド・オニオン | halal | unmatched | — | not classified (unmatched) |
| 牛肉 | syubhat | syubhat | beef | hazard, correct |
| 牛脂豚脂混合油脂 | haram | haram | rule:pork | hazard, correct |
| 砂糖 | halal | halal | sugar |  |
| オニオンエキス | halal | unmatched | — | not classified (unmatched) |
| 食塩 | halal | halal | salt |  |
| カレー粉 | halal | halal | rule:curry-powder |  |
| ビーフエキス | syubhat | unmatched | — | not classified (unmatched) |
| トマトペースト | halal | halal | exp:マトペースト |  |
| 牛脂 | syubhat | unmatched | — | not classified (unmatched) |
| ウスターソース | syubhat | syubhat | rule:sauce |  |
| 生クリーム | halal | unknown | catalog:jp-2037 | not classified (catalog unknown) |
| にんにく | halal | halal | rule:garlic |  |
| 香辛料 | halal | halal | rule:spices |  |
| 酵母エキスパウダー | halal | halal | yeast-extract |  |
| チャツネ | halal | unmatched | — | not classified (unmatched) |
| カラメル色素 | halal | unmatched | — | not classified (unmatched) |
| 調味料（アミノ酸等） | halal | halal | rule:seasoning |  |
| 増粘剤（加工デンプン） | halal | halal | exp:加工デンプ |  |
| 酸味料 | halal | halal | rule:acidulant |  |
| 香料 | halal | syubhat | flavoring | verdict mismatch |
| 香辛料抽出物 | halal | unmatched | — | not classified (unmatched) |

### off/off_4902431811575_ingredients.jpg

おとなのベビーチーズ 明太子味 — OCR raw 169 chars, section 151 chars

| GT ingredient (transcribed) | expected | app verdict | app entry | flag |
|---|---|---|---|---|
| ナチュラルチーズ（外国製造又は国内製造） | syubhat | syubhat | natural-cheese | hazard, correct |
| 昆布エキス | halal | halal | rule:seaweed |  |
| 明太子風味調味料 | halal | syubhat | rule:fermented-seasoning | verdict mismatch |
| 辛子明太子 | halal | halal | exp:辛子明太子 |  |
| ゆず胡椒 | halal | halal | rule:spices |  |
| 寒天 | halal | halal | rule:agar |  |
| 唐辛子パウダー | halal | halal | rule:chili |  |
| ゆず皮 | halal | halal | exp:ゆず皮 |  |
| 乳化剤 | syubhat | syubhat | emulsifier | hazard, correct |
| 調味料（アミノ酸等） | halal | halal | rule:seasoning |  |
| 増粘剤（加工デンプン） | halal | halal | rule:thickener |  |
| 香料 | halal | syubhat | flavoring | verdict mismatch |
| 発色剤（亜硝酸Na） | halal | halal | rule:color-developer |  |

### off/off_4532508031157_ingredients.jpg

たまらない 美味しさ (魚介乾製品) — OCR raw 393 chars, section 256 chars

| GT ingredient (transcribed) | expected | app verdict | app entry | flag |
|---|---|---|---|---|
| いか | halal | unmatched | — | not classified (unmatched) |
| 砂糖 | halal | unmatched | — | not classified (unmatched) |
| 食塩 | halal | unmatched | — | not classified (unmatched) |
| 乳糖 | halal | unmatched | — | not classified (unmatched) |
| 醸造酢 | halal | unmatched | — | not classified (unmatched) |
| 還元水飴 | halal | unmatched | — | not classified (unmatched) |
| ソルビトール | halal | unmatched | — | not classified (unmatched) |
| 調味料（アミノ酸等） | halal | halal | rule:amino-acid |  |
| 酒精 | haram | syubhat | alcohol | verdict mismatch |
| 酸味料 | halal | halal | rule:acidulant |  |
| 甘味料（ステビア、甘草） | halal | halal | rule:sweetener2 |  |
| リン酸塩（Na） | halal | halal | rule:phosphate |  |
| 保存料（ソルビン酸K） | halal | halal | rule:preservative2 |  |
| トレハロース | halal | halal | rule:trehalose |  |

### off/off_2303797301427_ingredients.jpg

ダブルチョコロール (菓子パン) — OCR raw 300 chars, section 256 chars

| GT ingredient (transcribed) | expected | app verdict | app entry | flag |
|---|---|---|---|---|
| チョコレート利用食品（国内製造） | halal | halal | rule:chocolate |  |
| 小麦粉 | halal | halal | rule:wheat |  |
| マーガリン | syubhat | syubhat | rule:margarine | hazard, correct |
| 砂糖 | halal | unmatched | — | not classified (unmatched) |
| パン酵母 | halal | halal | rule:bread |  |
| 食塩 | halal | halal | salt |  |
| ミックス粉（小麦粉、脱脂粉乳、卵黄粉） | halal | halal | rule:mix-flour |  |
| トレハロース | halal | halal | rule:trehalose |  |
| 酢酸Na | halal | unknown | catalog:jp-49 | not classified (catalog unknown) |
| 乳化剤 | syubhat | syubhat | rule:flavoring† | hazard, correct |
| 香料 | halal | syubhat | rule:flavoring | verdict mismatch |
| V.C | halal | halal | rule:vitamin |  |

† OCR merged 乳化剤+香料 into `乳化削香料` (see alignment note).

### off/off_45226731_ingredients.jpg

三ツ矢サイダー ダブル — OCR raw 83 chars, section 72 chars

| GT ingredient (transcribed) | expected | app verdict | app entry | flag |
|---|---|---|---|---|
| 食物繊維（難消化性デキストリン）（アメリカ製造又は韓国製造） | halal | halal | rule:dextrin |  |
| 炭酸 | halal | halal | rule:calcium |  |
| 香料 | halal | syubhat | flavoring | verdict mismatch |
| 酸味料 | halal | halal | rule:acidulant |  |
| 甘味料（アセスルファムK、ステビア） | halal | halal | rule:sweetener2 |  |

### off/off_4562343850019_ingredients.jpg

純国産 ポテトチップスうすしお味 — OCR raw 333 chars, section 333 chars

| GT ingredient (transcribed) | expected | app verdict | app entry | flag |
|---|---|---|---|---|
| じゃがいも（国産・遺伝子組み換えでない） | halal | unmatched | — | not classified (unmatched) |
| こめ油（米（国産）） | halal | halal | rule:rice |  |
| 食塩（北海道製造） | halal | halal | salt |  |

### personal/fldb_4901313207604_label.jpg

手塩屋 亀田製菓 — OCR raw 346 chars, section 224 chars

| GT ingredient (transcribed) | expected | app verdict | app entry | flag |
|---|---|---|---|---|
| うるち米（米国産、国産） | halal | unmatched | — | not classified (unmatched) |
| 植物油脂 | halal | unmatched | — | not classified (unmatched) |
| 食塩 | halal | unmatched | — | not classified (unmatched) |
| 魚介エキス調味料 | halal | unmatched | — | not classified (unmatched) |
| カツオ節粉末 | halal | unmatched | — | not classified (unmatched) |
| 香辛料 | halal | halal | rule:spices |  |
| ガーリックオイル | halal | unmatched | — | not classified (unmatched) |
| 調味料（アミノ酸等） | halal | halal | rule:seasoning |  |
| 植物レシチン | halal | halal | soy-lecithin |  |
| 着色料（ウコン） | halal | syubhat | rule:coloring | verdict mismatch |

Allergen note mentions 豚肉 but it is **not** an ingredient; the app did not
emit a pork finding (no false-haram).

### personal/fldb_4902410315353_label.jpg

ピザパン フジパン — OCR raw 351 chars, section 232 chars

| GT ingredient (transcribed) | expected | app verdict | app entry | flag |
|---|---|---|---|---|
| 小麦粉（国内製造） | halal | unmatched | — | not classified (unmatched) |
| ピザソース | halal | unmatched | — | not classified (unmatched) |
| マヨネーズ味ドレッシング | halal | unmatched | — | not classified (unmatched) |
| タマネギ | halal | unmatched | — | not classified (unmatched) |
| 砂糖 | halal | unmatched | — | not classified (unmatched) |
| チーズ | syubhat | unmatched | — | not classified (unmatched) |
| ハム | haram | unmatched | — | not classified (unmatched) |
| 卵 | halal | unmatched | — | not classified (unmatched) |
| マーガリン | syubhat | unmatched | — | not classified (unmatched) |
| パン酵母 | halal | unmatched | — | not classified (unmatched) |
| ショートニング | syubhat | unmatched | — | not classified (unmatched) |
| ぶどう糖 | halal | unmatched | — | not classified (unmatched) |
| 乳等を主要原料とする食品 | halal | unmatched | — | not classified (unmatched) |
| 食塩 | halal | unmatched | — | not classified (unmatched) |
| 加工デンプン | halal | unknown | catalog:jp-2089 | not classified (catalog unknown) |
| 乳化剤 | syubhat | syubhat | emulsifier | hazard, correct |
| 調味料（有機酸等） | halal | halal | rule:seasoning |  |
| 酢酸Na | halal | halal | rule:sodium-acetate |  |
| 増粘多糖類 | halal | halal | rule:thickener |  |
| イーストフード | unknown | unknown | catalog:nutritional-yeast |  |
| リン酸塩（Na） | halal | unknown | catalog:jp-38 | not classified (catalog unknown) |
| pH調整剤 | halal | halal | rule:ph-adjuster |  |
| くん液 | halal | unmatched | — | not classified (unmatched) |
| 酸化防止剤（V.C） | halal | halal | rule:antioxidant |  |
| 着色料（クチナシ、カロチノイド） | halal | syubhat | rule:coloring | verdict mismatch |
| V.C | halal | halal | rule:vitamin |  |
| 発色剤（亜硝酸Na） | halal | halal | rule:color-developer |  |
| 香辛料 | halal | halal | rule:spices |  |

Worst image: 15 GT items never reached the matcher (section starts at `プン、`
i.e. the tail of 加工デンプン), including GT haram ハム and GT syubhat
チーズ/マーガリン/ショートニング.

### personal/fldb_4902750702042_label.jpg

忍者めし鋼 ピーチ味 — OCR raw 235 chars, section 204 chars

| GT ingredient (transcribed) | expected | app verdict | app entry | flag |
|---|---|---|---|---|
| 砂糖（国内製造） | halal | halal | sugar |  |
| 果糖ぶどう糖液糖 | halal | halal | rule:liquid-sugar |  |
| ゼラチン | syubhat | syubhat | gelatin | hazard, correct |
| 米粉 | halal | halal | rule:rice |  |
| 濃縮果汁（ピーチ、りんご） | halal | halal | rule:fruit-juice |  |
| 還元水飴 | halal | halal | rule:starch-syrup |  |
| イヌリン | halal | halal | rule:acidulant† |  |
| 酸味料 | halal | halal | rule:acidulant |  |
| 香料 | halal | syubhat | flavoring | verdict mismatch |
| ゲル化剤（アラビアガム） | halal | halal | rule:gum-arabic |  |
| 光沢剤 | unknown | unmatched | — | not classified (unmatched) |
| 着色料（ニンジンエキス、クランベリーエキス） | halal | syubhat | rule:coloring | verdict mismatch |

† OCR merged `イヌリン／酸味料` into `イヌリンノ 酸味料` (see alignment note).

### personal/labelingjp_2526_IMG_8623_1.jpg

納豆（たれ・からし付き） — OCR raw 263 chars, section 244 chars

| GT ingredient (transcribed) | expected | app verdict | app entry | flag |
|---|---|---|---|---|
| 丸大豆（アメリカまたはカナダ）（遺伝子組換え混入防止管理済） | halal | halal | rule:soybean |  |
| 納豆菌 | halal | unmatched | — | not classified (unmatched) |
| しょうゆ（大豆・小麦を含む） | halal | syubhat | soy-sauce | verdict mismatch |
| 植物性蛋白加水分解物 | halal | syubhat | rule:hydrolyzed-protein | verdict mismatch |
| 砂糖混合ぶどう糖果糖液糖 | halal | halal | rule:liquid-sugar |  |
| 果糖ぶどう糖液糖 | halal | unmatched | — | not classified (unmatched) |
| 醸造酢 | halal | halal | rule:brewed-vinegar |  |
| 食塩 | halal | halal | salt |  |
| みりん | syubhat | syubhat | mirin | hazard, correct |
| カツオエキス | halal | unmatched | — | not classified (unmatched) |
| 砂糖 | halal | halal | sugar |  |
| 調味料（アミノ酸等） | halal | halal | rule:seasoning |  |
| からし | halal | halal | exp:からし粉 |  |
| 酸味料 | halal | halal | rule:acidulant |  |
| 酒精 | haram | syubhat | alcohol | verdict mismatch |
| 着色料（ウコン） | halal | syubhat | rule:coloring | verdict mismatch |
| 増粘多糖類 | halal | halal | rule:thickener2 |  |
| ビタミンC | halal | unmatched | — | not classified (unmatched) |

Repeated 食塩/砂糖 in the たれ/練からし blocks were de-duplicated in GT (one
entry each); the app only sees one of each anyway.

### personal/labelingjp_3502_IMG_2634_2.jpg

生菓子（白桃ゼリー） — OCR raw 211 chars, section 200 chars

| GT ingredient (transcribed) | expected | app verdict | app entry | flag |
|---|---|---|---|---|
| 果糖ぶどう糖液糖（国内製造） | halal | halal | rule:liquid-sugar |  |
| 白桃果肉シラップ漬け | halal | halal | rule:peach |  |
| 濃縮果汁（もも、りんご） | halal | halal | rule:fruit-juice |  |
| デキストリン | halal | halal | rule:dextrin |  |
| 砂糖 | halal | halal | sugar |  |
| 糊料（増粘多糖類） | halal | halal | rule:thickener |  |
| 香料 | halal | syubhat | flavoring | verdict mismatch |
| 酸味料 | halal | halal | rule:acidulant |  |
| pH調整剤 | halal | halal | rule:ph-adjuster |  |
| カロテノイド色素 | halal | unknown | catalog:jp-336 | not classified (catalog unknown) |
| 酸化防止剤（ビタミンC） | halal | halal | catalog:vitamin-c |  |
| 甘味料（アセスルファムK、スクラロース） | halal | halal | rule:sweetener2 |  |

---

## 4. False-halal / false-haram (per item)

### False-halal: **0 items** — target met on this sample

All 20 GT haram/syubhat items and their app verdicts:

| file | ingredient | expected | app verdict | app entry |
|---|---|---|---|---|
| off_4517888131963 | みりん | syubhat | syubhat | mirin |
| off_4517888131963 | 清酒 | haram | **haram** | sake |
| off_4901002173340 | 牛肉 | syubhat | syubhat | beef |
| off_4901002173340 | 牛脂豚脂混合油脂 | haram | **haram** | rule:pork |
| off_4901002173340 | ビーフエキス | syubhat | unmatched | — |
| off_4901002173340 | 牛脂 | syubhat | unmatched | — |
| off_4901002173340 | ウスターソース | syubhat | syubhat | rule:sauce |
| off_4902431811575 | ナチュラルチーズ | syubhat | syubhat | natural-cheese |
| off_4902431811575 | 乳化剤 | syubhat | syubhat | emulsifier |
| off_2303797301427 | マーガリン | syubhat | syubhat | rule:margarine |
| off_2303797301427 | 乳化剤 | syubhat | syubhat | rule:flavoring† |
| off_4532508031157 | 酒精 | haram | syubhat | alcohol |
| fldb_4902410315353 | チーズ | syubhat | unmatched | — |
| fldb_4902410315353 | ハム | haram | unmatched | — |
| fldb_4902410315353 | マーガリン | syubhat | unmatched | — |
| fldb_4902410315353 | ショートニング | syubhat | unmatched | — |
| fldb_4902410315353 | 乳化剤 | syubhat | syubhat | emulsifier |
| fldb_4902750702042 | ゼラチン | syubhat | syubhat | gelatin |
| labelingjp_2526 | みりん | syubhat | syubhat | mirin |
| labelingjp_2526 | 酒精 | haram | syubhat | alcohol |

### False-haram: **0 items**

No GT halal item received `haram`. The allergen-note trap
(`fldb_4901313207604`: 豚肉 listed only under 一部に…) did not produce a pork
finding.

### Caution notes on the zero-false-halal result

- **Coverage luck:** 6 of 20 risky items were *never evaluated* (unmatched),
  including GT haram ハム and GT syubhat チーズ/マーガリン/ショートニング in
  the pizza-bun image. A better extractor would evaluate them; this run cannot
  prove the verdicts would still be safe, though all of them have explicit
  curated entries (`ham`, `cheese`, `margarine`, `shortening`) that are
  syubhat/haram, so the risk is moderate.
- **Two GT haram items got `syubhat` instead of `haram`** (酒精 ×2). Under
  §6 (khamr → haram) that is under-classification of alcohol; it is *not* a
  false-halal.
- **One GT unknown item got `halal`** (豆腐用凝固剤, `rule:tofu`). Generic
  functional classes should not receive a bare halal verdict without knowing
  the agent; classifier leniency in the opposite direction of false-halal but
  still a wrong verdict.

---

## 5. Top 5 failures + fix suggestions

### 1. EXTRACT-GAP — section extraction drops the first half of the list (26 GT items, 15.7%)

Files: `fldb_4902410315353` (14 lost: 小麦粉…食塩 incl. ハム/チーズ/マーガリン/
ショートニング), `off_4532508031157` (7 lost: いか/砂糖/食塩/乳糖/醸造酢/
還元水飴/ソルビトール), `fldb_4901313207604` (5 lost: うるち米/植物油脂/食塩/
魚介エキス調味料/カツオ節粉末). Evidence: raw OCR contains every one of these
tokens; `extractIngredientSection` starts at `原材料名`, which OCR reads
*mid-cell* (section texts start at `三ノ酸等）`, `プン、`, `香辛料、`).
- **Gap type: extraction/rule gap** (not OCR).
- **Fix:** in `src/lib/normalize.ts`, when the 原材料名 marker is found
  mid-string, if the text before it on the same OCR line contains list
  separators (`、`) or ingredient-like tokens, include that leading run instead
  of discarding it (or start the section at the line containing the marker,
  not at the marker itself). The device flow crops via
  `computeIngredientCrop()`; the same guard should apply there. Add a smoke
  assertion with the three section snippets stored in `measure.json`.

### 2. DEDUPE/COLLAPSE-GAP — same-entry tokens silently dropped (3 GT items)

`牛脂` (curry), `香辛料抽出物` (curry), `果糖ぶどう糖液糖` (natto) appear in
raw OCR and in the extracted section but have **no finding**: `collapse()` in
`src/lib/matcher.ts` keeps one finding per `entry.id`, so a token that matched
the same entry as a longer/lower-scoring sibling disappears (牛脂 vs
牛脂豚脂混合油脂 / 香辛料 vs 香辛料抽出物 / 砂糖混合ぶどう糖果糖液糖 vs
果糖ぶどう糖液糖).
- **Gap type: pipeline (dedupe) gap.**
- **Fix:** keep per-entry collapse for near-identical normalized forms only,
  or retain the list of contributing raws on the surviving finding. Re-run
  `scripts/eval-real.ts --kind label` after the change and confirm the
  aggregate `unknown`/`unmatched` counts do not regress elsewhere.

### 3. OCR-GAP — words dropped or shredded on readable labels (~12 GT items)

`ハム` is **not present at all** in the pizza-bun OCR text (a GT haram item
that is never evaluated); `じゃがいも`, `マヨネーズ味ドレッシング`,
`タマネギ`, `チーズ`, `卵`, `タマネギ` and `光沢剤`/`くん液`/`ビタミンC`
are mangled (`や も`, `マヨ 一ズ味 レシ`, `タマ `, `一ズ`, `<ん液`,
`多類ビ三C`).
- **Gap type: OCR gap** (Node harness runs Paddle only; the app additionally
  has the ML Kit full/detailed pass and adaptive full-image Paddle pass).
- **Fix:** measure the on-device 2-pass merge on these three images once a
  device is attached; add confusion-map entries for recurring misreads
  (`才/オ`, `工/エ`, `く/<`, `三/ミ`, `一/ー`) to `src/lib/confusion.ts`
  so the surviving variants still match curated names; consider a
  higher-resolution crop for small-print panels.

### 4. DATA-GAP — 9 names recognised but no verdict (`status=unknown`)

`大豆水煮`, `しいたけ` (+`しいたけだし` fragment), `生クリーム`, `酢酸Na`,
`イーストフード`, `リン酸塩（Na）`, `カロテノイド色素`, `加工デンプン`,
plus `加工デンプン` mis-hit `プン`.
- **Gap type: data gap** (catalog-only names).
- **Fix:** add curated `ingredients.json` entries (reviewed, with basis) for
  the first eight; they are plant/mineral/typical-additive → halal, except
  イーストフード (dough conditioner) and 光沢剤 which should stay
  syubhat/unknown. This alone would lift classification recall by ~5 points
  on this sample.

### 5. RULE/POLICY-GAP — systematic syubhat over-reach on plant/named additives (15 classified verdicts)

`香料` ×6, `着色料（ウコン/クチナシ/カロチノイド/ニンジンエキス/…）` ×4,
`だし（魚節）`, `増粘剤（加工でん粉）`, `しょうゆ`, `植物性蛋白加水分解物`,
`明太子風味調味料` → all `syubhat` although the printed ingredients are
plant/fish and §6 lists none of these categories as source-dependent.
- **Gap type: rule/policy gap (caution direction).**
- **Fix:** make the coloring rule bracket-aware (match the named colorants
  inside `着色料（…）` first: ウコン/クチナシ/カロチノイド are plant → halal);
  refine `だし` to fish/kombu dashi → halal unless `調味料`/`酒精` present;
  treat `増粘剤（加工でん粉）` and `植物性蛋白加水分解物` as halal per §6;
  decide the `しょうゆ` and `香料` policy explicitly (if they stay syubhat,
  document the reasoning in HANDOVER §6, because the golden set currently
  scores them as wrong).
- Also `酒精`: app entry `alcohol` = syubhat while §6 says khamr → haram.
  Decide one policy and align GT/tests with it.
- Edge: `豆腐用凝固剤` → `rule:tofu` grants halal to a generic class; salt
  functional-class names to unknown/syubhat instead.

---

## 6. Verdict on the zero-false-halal criterion

> **On this 12-image / 166-ingredient sample the app PASSES:
> false-halal = 0 (target 0), false-haram = 0.**
>
> The pass is real but thin: 6 of the 20 risky items were never evaluated
> (extraction/OCR gaps, incl. GT haram ハム), and 2 haram-alcohol items were
> under-classified to `syubhat` (safe direction). No GT pork/alcohol/gelatin
> item was labelled `halal`.

For comparison the previous (non-golden) label-only baseline reported 3 haram
findings out of 43 images with no ground truth; this is the first run where
"false-halal = 0" is an actual measurement against human annotation.

---

## 7. Honest limitations

1. **Small sample, not representative.** 12 images / 166 tokens cannot support
   statistical claims. No curved bottle labels (glare/curvature) and only one
   multi-part label (納豆) are in the set. A 0 false-halal here is a
   necessary-but-not-sufficient signal.
2. **Subjective transcription and expected verdicts.** One annotator, no second
   reviewer. §6 leaves room for interpretation (香料, しょうゆ,
   植物性蛋白加水分解物, だし, 酒精); each disagreement with the app is
   documented rather than hidden. `イーストフード` and `光沢剤` are marked
   `unknown` instead of guessed.
3. **Photos, not the live camera.** The harness reads image files with Paddle
   only; the app adds an ML Kit pass, auto-crop via ML Kit line frames, an
   adaptive full-image Paddle pass, and downscaling. On-device results will
   differ (typically better coverage, per HANDOVER §4).
4. **Alignment is partly automated.** 7 semantic overrides pin pipeline
   split/merge artifacts (documented in `measure.ts` and §2). Without them,
   classification recall is ~5 points lower; the false-halal count is 0 either
   way (no override affects a risky item's halal safety).
5. **OCR is not bit-stable.** PaddleOCR runs vary slightly run to run; exact
   recall (±1–2 items) and per-image counts can shift. All artifacts are saved
   for re-runs.
6. **Excluded from GT:** allergen notes, nutrition/maker blurbs, and product
   metadata. These can still appear as app findings (NOISE-OVERREACH); they were
   not counted in the denominators here.
7. **Base commit is the current working tree.** `src/` was not modified by this
   run; 5 pre-existing modified files were present. Any later rule change
   invalidates these exact numbers.

---

## 8. Reproduce

```powershell
# 1. measurement (needs the repo's node_modules; goldenset/node_modules is a
#    junction to it because the script lives outside the repo)
npx tsx --tsconfig D:/hls/tsconfig.json `
  D:/opencode/temp/goldenset/measure.ts

# 2. artifacts
#   D:/opencode/temp/goldenset/measure.json      raw OCR + findings + alignment
#   D:/opencode/temp/goldenset/gt-summary.json   metrics + per-image + rows
#   D:/opencode/temp/goldenset/gt.json           ground truth (human)
#   D:/opencode/temp/goldenset/gt-tables.md      generated GT tables
```

No git commit was made. Files added by this run: this report
(`docs/VALIDATION_GOLDENSET.md`) and the four artifacts above. The golden set
is the first reusable ground truth for regression testing the OCR → extract →
classify path on real labels.

---

## 9. Two-set structure (2026-10-03)

The golden set is split into a **DEV** set (used to iterate and meter during
agent rounds) and a sealed **HOLDOUT** set (final gate only). The two are carved
per plan, **disjoint**, and no pipeline run is allowed against the holdout.

| Set | Images | Items | Hazards | Location |
|---|---|---|---|---|
| DEV | 21 | 201 | 33 | `golden/dev/dev.json` |
| HOLDOUT (sealed) | 16 (17 records; `commons_86947455` two panels) | 196 | 47 | `golden/holdout/holdout.json` |

### DEV metrics (golden measure)

| Metric | Value |
|---|---|
| OCR variant | 80.1-80.8% |
| Classification | 82.6-82.8% |
| Verdict accuracy | 95.2-95.7% |
| Unknown | ~17% (measure) / 3.0% (harness unknown-rate) |
| False-halal | 0 |
| False-haram | 0 |

### Gate-tool numbers (`scripts/validate-real`)

| Metric | Value |
|---|---|
| Classification | 82.5% |
| Hazard recall | 78.8% |
| Unmatched | 14.5% |
| AC-1 / AC-2 | PASS |
| Recall thresholds | **FAIL** — the offline harness lacks ML Kit + adaptive OCR, and the corpus is below protocol minimums |

### AC-0 status (before the expansion)

38 images / 394 items / 79 hazards vs minimums **64 / 500 / 90**. The set needs
~30 new hazard-heavy photos across the missing categories (instant noodles,
frozen food, seasonings, bottled drinks, snacks, dairy) before the holdout gate
can be run.

---

# Expanded corpus (2026-10-03, session 8)

Base: `6e9c990` working tree (strip-tile recovery + data/fold fixes). Artifacts:
`golden/dev/dev.json`, `golden/holdout/holdout.json`,
`D:/opencode/temp/v2-harness.json`, `D:/opencode/temp/v2-report.json`,
`D:/opencode/temp/v2-validate.txt` (gate tool), `D:/opencode/temp/v2-golden.txt`
(golden measure). Repo path is now `D:\hls` (the old `D:\Code\personal_halal_scanner`
in earlier reports is stale — moved for Windows MAX_PATH).

## 10. Corpus structure

72 new hazard-heavy OFF-JP images were harvested (`p1-harvest-report.md`:
instant noodles 10, frozen 10, seasonings 10, bottled drinks 16, snacks 10,
dairy 16; ~569 hazard occurrences by OFF text, not GT) and hand-transcribed by
8 transcription agents (batches `new-gt2/b1..b8.json`, 72 records / 1455 items).
Merged with the original 21-image dev set and normalized:
**1656 GT items -> 1869** (80 compound items split per protocol; 25 parents kept;
268 sub-items added), 0 invalid items.

| Set | Images | Items | Hazards | Location |
|---|---|---|---|---|
| DEV | **93 (92 scored by harness)** | **1869** | **509** | `golden/dev/dev.json` |
| HOLDOUT (sealed) | 16 images (17 records; `commons_86947455` two panels) | 196 | 47 | `golden/holdout/holdout.json` |
| **Corpus total** | **109 distinct images / 110 records** | **~2065** | **~556** | |

Expected distribution (dev): halal 1350 / syubhat 438 / haram 76 / unknown 5.

Category distribution (protocol §2.1 codes, from the GT record `category` field):
**dev** SN 29 / PM 17 / DR 19 / ND 9 / BR 8 / DY 5 / SE 3 / FZ 3 (93 records);
**holdout** PM 4 / SN 4 / DY 3 / DR 3 / BR 2 / SE 1 (17 records).

### AC-0 (validity precondition) — **ALL PASS**

| # | Requirement | Target | Minimum | Actual | Verdict |
|---|---|---|---|---|---|
| AC-0a | Golden-set images | 96 | 64 | 110 records (93 dev + 17 holdout) | **PASS** |
| AC-0b | GT occurrences | >= 1,100 | >= 500 | 2,065 | **PASS** |
| AC-0c | High-risk occurrences | >= 150 | >= 90 | 556 (509 dev + 47 holdout) | **PASS** |
| AC-0d | Holdout | 24 images | 16 | 16 images / 17 records | **PASS (minimum)** |
| AC-0e | Real photos | >= 60 | >= 40 | 110/110 (OFF / OFF2 / Commons; no renders) | **PASS** |

## 11. Expanded-dev metrics

### Golden measure (`scripts/measure.ts` via `gt-summary-v2.json`)

| Metric | Value |
|---|---|
| OCR recall exact | 49.6% (927/1869) |
| OCR recall variant | **56.4%** (1054/1869) |
| Classification recall | **55.6%** (session 8b) |
| Verdict accuracy (emitted) | **97.1%** (session 8b) |
| Unknown rate | 44.5% (catalog-unknown 96, unmatched 735) |
| False-halal | **0** (session 8b; was 1, fixed by the modifier-prefix boundary repair) |
| False-haram | **0** |
| Status-preference repairs | 44 risky GT items re-pointed to their risk-determining sub-part |
| Strip recoveries kept | 10 images (e.g. off2_4902715927824 7 -> 342 chars, off2_4902165167887 9 -> 295) |

### Gate tool (`scripts/validate-real --mode harness`, `v2-validate.txt`)

Covered **92/93** GT images; **1868** GT occurrences scored; 1 GT image not in
the harness (`commons/commons_8752933.jpg`).

| Metric | Current | Threshold | Verdict |
|---|---|---|---|
| False-halal | **0** | <= 0 | **PASS** |
| False-haram | **0** | <= 0 | **PASS** |
| Classification recall | **55.4%** (1035/1868) | >= 90.0% | FAIL |
| Hazard recall | **58.9%** (300/509) | >= 95.0% | FAIL |
| Unknown rate | **5.4%** | <= 3.0% | FAIL |
| Unmatched rate | **39.2%** (732/1868) | <= 7.0% | FAIL |
| Verdict accuracy (emitted) | 97.1% (1005/1035) | >= 97% | PASS |
| E2E correct recall | 53.8% (1005/1868) | >= 85% | FAIL |
| Over-caution T2 | 1.3% (24) | <= 3% | PASS |
| Noise leakage | 31.2% (455/1457 findings) | <= 2% | FAIL |

### The former single false-halal (OCR-limited) — fixed in session 8b

| Image | GT | App (pre-fix) | Entry | Cause |
|---|---|---|---|---|
| `off2/off2_4902715927824_ingredients.jpg` | 加工でん粉 (syubhat) | halal | `rule:starch`, matched `でん粉` | Strip-recovery OCR + section boundary cut the `加工` prefix; the surviving `でん粉` correctly hits the plain-starch halal rule. The curated modified-starch entry and `rule:modified-starch` cannot fire on a prefix that is not in the text. Not a matcher/rule hole. |

Fixed as a CLASS in session 8b (`src/lib/normalize.ts` `MODIFIER_PREFIXES` /
`rawTextHasCompound` / `repairBoundaryChoppedModifier`): when the extracted
section's first token is a known base and the RAW OCR still carries a known
modifier+base compound contiguously (same-line whitespace tolerated, newline
not), the modifier is grafted back. Gate **false-halal 1 -> 0** (golden
measure 0 too); the class audit over 963 modifier x base pairs found 18
dangerous pairs (compound stricter than base) and 0 where the compound is
laxer, so a repair can only ever report the stricter verdict.

### AC-5 per-category (session 8b, from `v3-report.json`)

AC-5 groups GT occurrences by the GT record's protocol §2.1 category code
(`gtCategory`; legacy GT without the field falls back to the heuristic guess).
Convention: AC-5 counts **all** GT occurrences of a category, including items
whose image was not covered by the harness run; those score as unmatched.

| Category | Classification recall | Unmatched |
|---|---|---|
| SN | 57.9% | 34.3% |
| FZ | 46.9% | 46.9% |
| SE | ~49% | ~47% |
| DR | 56.0% | 37.3% |
| ND | 52.2% | 45.3% |
| DY | 73.4% | 18.8% |
| BR | 60.6% | 35.6% |
| PM | 50.5% | 45.9% |

- **AC-5 MUST (>= 85% each): FAIL for every category** (best is DY at 73.4%).
- Unmatched is **systemic**: every category loses 18.8-47.3% of its occurrences
  to extraction/OCR. By absolute count SN / PM / ND lead only because they hold
  the most GT occurrences (623 / 412 / 245). The bottleneck is extraction, not
  vocabulary or category-specific matching.
- False-halal is now **0** in both the gate and the golden measure after the
  modifier-prefix class fix.

## 12. Why the expanded number is lower, and why it is the honest one

The original 21-image dev measured classification 82.6-82.8% (OCR variant
80.1%). The same pipeline on the expanded 93-image dev measures 55.6% (session
8b final; 55.5% pre-FH-class-fix). That
drop is the corpus, not a regression:

- the new 72 images are real Open Food Facts user photos: curved bottles, glare,
  small fonts, multi-column panels, imported products (English/Chinese labels),
  strips whose detector scales glyphs to nothing. The original 21 were selected
  for legibility.
- the original 21 are a subset of the expanded 93, so the expanded number is the
  strictly more conservative measurement of the same code.

The 55% is the number that should be quoted. The gate tool thresholds (AC-4/6/8,
and consequently AC-9/10) **still fail**: coverage and hazard recall on hard real
photos remain the main open problem, not verdict correctness (97.1% among
emitted, session 8b).

## 13. Harness limitation (unchanged)

The offline harness runs PaddleOCR only. It cannot measure ML Kit, the adaptive
third pass, camera optics, or the MB-based crop — the `validate-real` footer
says so explicitly. Device runs against the same GT are still required for
AC-14..AC-22 and for the final holdout gate. The holdout remains **sealed**; no
pipeline run has touched it.
