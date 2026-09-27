# Debug log

Running record of scan-tuning sessions. Two sources:

1. **On-device persistent file** — every scan appends a JSONL record to the app's
   document directory (`scan-debug.jsonl`). Open **Debug Scan** on the home
   screen to read it, **Share** it, or clear it. Records include timing, passes,
   coverage, matched/unmatched, per-ingredient hits and misses, the merged
   ingredient section and the raw OCR text per engine.
2. **logcat** (live, rotates away): `adb logcat -d | findstr HALALDBG`
   (set `DEBUG_VERBOSE = true` in `src/lib/debug.ts`).

`OCR ms=` breakdown fields: `cropped`, `passes`, `coverage` (ingredient-section
length used by the adaptive gate). Per-pass lines: `PASS ML-penuh`,
`PASS Paddle-crop`, `PASS Paddle-penuh`, `SKIP Paddle-penuh (coverage=…)`.

---

## History

| # | Focus | Result |
|---|---|---|
| 1 | Baseline (ML Kit only) | ~5–11 s/scan; section extraction + noise filter needed |
| 2 | Section marker robustness | `所材料名`/`原材名`/`対料名` handled; label noise dropped |
| 3 | Japan-specific rules | mirin/料理酒, 動物性エキス, コチニール, 酒粕, dll |
| 4 | E-number table (MUIS arbiter) | 796 E-numbers; conflicts → syubhat |
| 5 | OFF vegan signal + ADDI citation | weak halal candidates; provenance |
| 6 | Frequency-ranked labelling | coverage 85.4% (weighted, top-800 tokens) |
| 7 | Auto-crop to 原材料名 | crop box from ML Kit line frames; boundary anchored at line start |
| 8 | Hybrid multi-pass OCR | full label + crop merged; recovered missed lines |
| 9 | Speed: 3-pass pipeline | 15.5 s → 6.5 s (drop useless pass, downscale, parallelise) |
| 10 | Speed: adaptive + crop downscale | **3.9 s** typical (2 passes); `SKIP Paddle-penuh` |
| 11 | NNAPI diagnostic | session created, but only ~3% faster and text looked worse → **rolled back** |
| 12 | Confusion map (Phase 2) | variant fold + weighted edit distance; 2-char tokens excluded by design |
| 13 | Rule variants | `ア三`, `微粒二酸化`, `酸化防`, `色料`, `即席`, `調味油`, `看料`, `果计`, `パ一ム油`, `レモグラス` |
| 14 | Persistent debug log | JSONL per scan in the app document dir + **Debug Scan** screen (share/clear); `docs/DEBUG_LOG.md` started |
| 15 | Low-quality hint + variant | result screen warns "hasil mungkin kurang akurat" when coverage is low (informational only); palm-oil accepts a stray char (`パ.ーム油`) |
| 16 | Photo-variance check | two scans of the same label: bad photo → 3 passes, matched 13, 7.3 s; good photo → 2 passes, matched 30, 4.4 s. **No code regression** (`git log` for OCR files empty) |
| 17 | Feedback loop | "Tandai salah" button per finding writes `{type:'feedback', sid, raw, entryId, status}` into the same JSONL log — real-usage signal for the curation backlog |

## Autonomous subagent iteration (rounds 2–10)

Driven by subagents with an independent verifier each round (multi cross-check).
Corpus: OFF-JP top-800 tokens (43,037 occurrences) + per-category buckets.

| Round | Work | Verified finding | Result |
|---|---|---|---|
| 2 | noise filter + fresh-food rules; eval harness built | verifier: "139 unknown" was wrong (135) | covered 85.5% → 85.6% |
| 3 | safety-critical (charshu/ham/spirits/animal fat) | collision audit: `/油脂/` order fragility | covered 86.2%, unknown 119 → 91 |
| 4 | anchored `/油脂/`, CN cluster | verifier: 動植物油脂→halal, 蛋白加水分解物→halal, デヒドロ酢酸→halal, ハム in dressing→halal | unknown 91 → 90 |
| 5 | fixed those 7 bugs | verifier: new regressions (ハムスライス→halal, 動植物蛋白→halal, グラハム→haram, グルタミン酸→carmine) | unknown 90 → 89 |
| 6 | fixed those 7 | verifier: **plant/fish extracts labelled haram** (麦芽エキス etc. fuzzy→豚肉エキス) | unknown 89 → 90 |
| 7 | **safety invariant: fuzzy never yields haram** | verifier: only 赤ワイン legitimately lost | unknown 90 |
| 8 | wine restore + rum/米酒/白酒/豚コラーゲン | final audit: 果実酒→halal, セパージュワイン→halal, ビール→syubhat via ビーフ | unknown 90 → 88 |
| 9 | **precedence: exact-curated > rules > fuzzy-curated > catalog**; alcohol rules; vegan guard | verifier: カクテルソース→haram, fermented seasonings lost caution | unknown 88 → 86 |
| 10 | cocktail lookahead; fermented-seasoning syubhat; 蒸し鶏/食肉/チーズパウダー | — | **covered 86.4%, unknown 1.4% (82)** |
| 11 | **bulk label expansion** (`scripts/expand-labels.mjs`, lexicon-driven, `exp:*` entries); generic-word noise filter | full-corpus weighted coverage 79.1% → 84.0%; 877 new curated entries; fuzzy-flip audit (952 flips, of which the 2 `syubhat→halal` were exact fixes of pre-existing fuzzy bugs みかん/ビート) | **covered 87.7%, noise 12.2%, unknown 0.2% (10)**; eval 99.7/92.1/83.8; labelled total 2,011 |

### Invariants now enforced (do not regress)

1. **Fuzzy matching may never produce a `haram` verdict** — haram requires an
   exact match (`src/lib/matcher.ts`). Fixed 15 mislabelled plant/fish extracts.
2. **Precedence: exact-curated > rules > fuzzy-curated > catalog** — an
   approximate curated hit must not shadow an explicit keyword rule.
3. **The OFF `vegan=yes` origin-signal must not grant halal to an
   alcoholic-looking name** (`looksAlcoholic()` in `src/lib/database.ts`).

### Final metrics after round 10

| Metric | Value |
|---|---|
| Weighted coverage (top-800) | **86.4%** |
| Noise | 12.1% |
| Unknown | **1.4% (82 tokens)** |
| Eval recall (clean / 15% / 30% OCR error) | 97.9 / 89.2 / 80.5 |
| High-stakes assertions | 19/19 (harness), 25/25 (independent) |
| Smoke tests | 37 groups, ALL PASS |
| Haram set | 37 corpus tokens, all explicit (exact or rule), 0 from fuzzy |

### Final metrics after round 11 (bulk expansion)

| Metric | Value |
|---|---|
| Weighted coverage (top-800) | **87.7%** |
| Noise | 12.2% |
| Unknown | **0.2% (10 tokens)** |
| Eval recall (clean / 15% / 30% OCR error) | **99.7 / 92.1 / 83.8** |
| High-stakes assertions | 19/19 |
| Smoke tests | 38 groups (114 new `[exp38]` assertions), ALL PASS |
| Haram set | 19 top-800 corpus tokens, all explicit, 0 from fuzzy |
| Labelled total (curated files + rules) | **2,011** (was 1,134) |

Bulk-expansion residual risk: the 877 `exp:*` entries are lexicon-reviewed but
not device-validated. The generator refuses halal when a token contains an
animal/alcohol marker, only emits haram from hand-written explicit tokens, and
refuses non-haram names one edit away from an existing haram entry. Bare
generic label words (パウダー/フィリング/あたり/粉末/ラベル/パック…) are now
label noise so fuzzy matching cannot attach a verdict to them.

## Representativeness caveat (open)

The 85.5% weighted coverage comes from **token frequency in the Open Food Facts
JP corpus** (top-800, 43,037 occurrences). It is a *theoretical* estimate.

Device validation so far covers **~2 categories only** (instant noodles, one
burger/sandwich). Not yet tested: dry seasoning/spice packs, bottled drinks
(curved label + glare), frozen food, small snack packs — different layout, font
size and vocabulary.

High-stakes classification decisions (mirin vs みりん風調味料, E120/cochineal in
kamaboko, lecithin split, meat = syubhat default) are covered by **synthetic
smoke tests only**, not by real product photos containing those ingredients.

Do not present these numbers as representative until cross-category validation
is recorded here per category.

## Current baseline (device: MediaTek MT6899)

| Metric | Value |
|---|---|
| OCR time | ~3.9 s (2 passes) / ~8 s (3 passes when coverage < 180) |
| Passes | ML Kit full + PaddleOCR crop (+ PaddleOCR full only when needed) |
| Matched / unmatched (noodle label) | 30 / 7 |
| Weighted coverage (top-800 JP tokens) | 85.5% |
| Unknown tokens | 2.6% |
| Smoke tests | 27 groups, all pass |

## Known limits

- OCR still misreads very small/curved kanji; remaining unmatched are mostly
  fragments, cooking instructions and addresses.
- 2-character tokens are exact-match only (protects 豚肉 vs 牛肉), so truncated
  2-char forms can only be covered by substring rule patterns.
- PaddleOCR dominates the remaining runtime (~3 s); it is CPU-bound
  preprocessing + inference. Forcing NNAPI did not help (see #11).

## Device round 2026-09-27 (4 real camera scans, 7 verifier rounds)

The first real camera scans found wrong verdicts that no synthetic test had
produced. Every item below was reproduced by an independent verifier subagent
and is pinned in scripts/smoke.ts.

| Class | Example | Was | Now |
|---|---|---|---|
| Meat cut -> halal | 豚もも肉, 豚肩ロース | halal:rule:peach / exp:スクロース | haram:rule:pork / meat-cut |
| Pork dish shadowed by halal sub-word | 豚の生姜焼き, 豚のりんご煮 | halal:rule:ginger / rule:seaweed | haram:rule:pork |
| Katakana cut / dish -> no finding | 豚モモ肉, 鶏白湯, 煮豚, カツ丼 | green banner | haram/syubhat by rule |
| Real meat line dropped | 製造用豚肉エキス, 豚肉工場製造 | no finding | haram:rule:pork |
| Allergen line swallowed | 一部に豚肉を含む | no finding | haram:rule:pork |
| Unreviewed OFF vegan -> green | catalog origin-signal halal | banner ok | effectiveStatus -> unknown |
| Conflicting duplicate entry | 加工デンプン | halal (other entry) | syubhat:modified-starch |
| OCR phrase misread | 添味料, カエでん粉, バーム油 | wrong/unknown | folded to 調味料/加工でん粉/パーム油 |
| 3-char fuzzy too loose | レート -> ビート | halal | refused (short-term gate) |
| Garbled allergen / soup row | 部仁卵乳成分小麦天豆肉, 水化物6.4大豆粉 | bogus halal | dropped as noise |
| Catalog data bug | 633 "[object Object]" names/eNumbers | junk | regenerated clean |

Non-claim wording is handled by NON_INGREDIENT_MENTION_RE (facility /
possibility / negation) plus a mention-count rule: a token with ONE animal
mention and a non-claim marker is dropped; anything else stays an ingredient
claim so NOISE_RE cannot swallow it. Bare 使用/使った/製品 are positive claims.

Metrics after the round: golden classification recall 83.7% (was 66.9%),
unknown 16.3% (was 33.1%), verdict accuracy 86.3%, false-halal 0,
false-haram 0; smoke ~990 assertions ALL PASS.
