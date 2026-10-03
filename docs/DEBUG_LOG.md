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

## Agent round 2026-10-03 (8-agent evaluation -> 8-agent implementation -> G1-G5)

| Phase | Agents | Result |
|---|---|---|
| Evaluation cluster | 8 | found the vitamin `/ve|vc/` false-halal (VEAL/VERMOUTH) + rule/data gaps |
| Implementation | 8 | F1 lib, F2 UX, F3 data, F4-F7 transcription+consistency, F8 gate tools |
| Release | G1-G5 | fix + cleanup + 5 commits + docs + release APK |

Key numbers: smoke ~1,120+ assertions ALL PASS; golden DEV 21 images / 201
items / 33 hazards; sealed HOLDOUT 16 images (17 records) / 196 items / 47
hazards; verdict accuracy 95.2-95.7%, false-halal 0, false-haram 0;
`validate-real` classification 82.5%, hazard recall 78.8%, unmatched 14.5%
(AC-1/AC-2 PASS; recall thresholds still FAIL — offline harness lacks ML
Kit/adaptive).

Vitamin fix (G4 pre-release blocker): the vitamin rule carried bare `/vc/` and
`/ve/` (added for OCR abbreviations of ビタミンC/E), which matched ANY token
containing them: `VEAL` (young beef) -> `halal:rule:vitamin` and `VERMOUTH`
(alcohol) -> `halal`. Both are false-halal on meat/alcohol. The Latin forms are
now anchored to the WHOLE normalized token, `/^v[ce](\d{1,2})?$/` (covers
VC/VE/VC12; `normalize()` strips dots so `V.C` already arrives as `vc`). VEAL
and VERMOUTH now fall through to unreviewed `unknown` catalog entries — never
halal. Pinned in `scripts/smoke.ts` §50n.

GT annotation fix: the 消泡剤 entry was split (消泡剤 vs the generic 消泡 form) so
the ground truth matches the pipeline's token split.

## Expanded-corpus round (session 8, 2026-10-03)

Base tree `e4d9d62`; this round ends at commits `6b723e5` (OCR strip-tile
recovery + faithful harness + alignment) and `6e9c990` (data/rules/folds), docs
commit follows. P/T/M/FIX/V agent cluster.

| Agent | Work | Key numbers |
|---|---|---|
| P1 | Harvest hazard-heavy OFF-JP panels (`off2/`) | **72 images** / 24.5 MB; instant noodles 10, frozen 10, seasonings 10, bottled 16, snacks 10, dairy 16; ~569 OFF-text hazard occurrences (not GT) |
| P2a/P2b | Scan 54 `kind=unknown` images for reusable panels | **0 new usable panels** (fronts/marketing only) |
| P3 | Pre-harvest label probe of the current tree | matched 373 / unmatched 159 / unknown 34 (was 365/171/50 at the G4 baseline) |
| P4 | First harness on the new pool (21-image dev subset) | 20/93 GT images covered: classification 86.0%, hazard 81.8%, unknown 2.0%, unmatched 12.0%, FH 0 / FR 0 |
| T1-T8 | Hand-transcribe the 72 off2 images (8 batches x 9) | **1455 items** transcribed (152/144/196/185/252/194/158/174); hazards 433 |
| M1 | Mirror the app path in the harness (strip retry + faithful findings) | Merged 1656 GT items (201 + 1455): classification 54.2%, hazard 54.3%, unmatched 41.1%, unknown 4.7%, verdict 91.1%, **false-halal 36** pre-normalization (32 syubhat + 4 haram) |
| FIX-A | Data: Japanese-language curated set + modified-starch variants | 955 curated entries; deleted bogus `exp:加工プン` / `exp:加工アンプン` / `exp:加工デンナン`; +31 EN entries (exp:en-*); 1 remaining status conflict (sodiumcaseinate) |
| FIX-B | Rules: pork/margarine/cream-cheese/creaming-powder + `rule:modified-starch` before starch/thickener | after FIX-B: **false-halal 36 -> 5** (5 items in `fb-report.json`) |
| FIX-C | OCR phrase folds + whitespace-strip order | after FIX-C: **false-halal 5 -> 1**; each new fold source zero-collision across ~14k DB names + 5531 corpus tokens (`v2-probe.log`) |
| V1 | Independent verifier: rescore P4 + data/rule audit | 20/93: classification 86.0%, hazard 81.8%, FH/FR 0; audit 958 entries: 0 dup ids, 2 curated collisions, fuzzy violations 0, cheap-pair violations 0, **1 fuzzy-halal-from-haram-mutation** (wine probe -> grape) |
| V2 | Full expanded run + gate + golden measure + probe | covered **92/93** GT images, 1868 occ.; gate FH **1** / FR 0; classification 55.3%, hazard 58.5% (298/509), unknown 5.4%, unmatched 39.3%, verdict 97.0%, E2E 53.6%, T2 1.3%, noise leakage 31.2%; smoke **1272 PASS**; eval 99.8 / 92.1 / 84.5, assertions 19/19 |

GT normalization: 80 compound items split per protocol -> **1656 -> 1869 items**
(25 parents kept, 268 sub-items added, 0 invalid). Distribution
halal 1350 / syubhat 438 / haram 76 / unknown 5.

Alignment rewrite (`validate-real`): exact > head/core > joined > prefix >
substring > fuzzy; qualifier-only-inside-parens is invalid; status-preference
pass repairs 44 risky GT items (disable with `--no-status-preference`).

Strip recovery: first pass below max(20, 7% x width) chars on an extreme strip
(width/height >= 3 or height < 240) -> 800px overlapping tiles (100px overlap),
keep merged if longer. Measured: `off_4823077629518_ingredients.jpg`
(2122x362) raw **8 -> 1115 chars** across 3 tiles; expanded dev kept 10 strip
recoveries (largest 7 -> 342 chars).

Metrics history this round: expanded-dev golden classification **55.5%** /
verdict 97.0% / OCR variant 56.4%; gate 55.3%. The lower number vs the original
21-image dev (82.6%) is the harder real-photo corpus (curved/glare/imported/
strip), not a regression — see `docs/VALIDATION_GOLDENSET.md` "Expanded corpus".

Known limits carried forward:

1. Gate false-halal = 1 (pre-session-8b), OCR-limited: `off2_4902715927824`
   加工でん粉 lost its `加工` prefix at the section boundary, so `でん粉` hit
   plain-starch halal. **Fixed as a class in session 8b -> 0** (see below).
2. Offline harness fidelity: ML Kit, adaptive 3rd pass, camera and MB crop are
   not measurable offline; AC-14..AC-22 remain device-run items.
3. Expanded corpus is far below accuracy thresholds (classification 55.3%,
   unmatched 39.3%); coverage on hard real photos is the open problem.
4. Corpus source bias: OFF/OFF2 user photos + Commons; 1 GT image
   (`commons/commons_8752933.jpg`) absent from the harness.
5. Residual data issues: sodiumcaseinate status conflict (syubhat/halal), 2
   curated name collisions, and the V1-audit fuzzy-halal-from-haram-mutation
   case (probe only).

## Session 8b (2026-10-04) — FH-class fix + AC-5 rollout

### The false-halal was a CLASS, not one image

Last remaining gate false-halal (`off2_4902715927824`: 加工でん粉 -> halal via
`rule:starch`) was a "modifier-prefix + base ingredient" boundary chop: a
mid-line 賞味期限 stop cut the OCR column line carrying the modifier, leaving
bare でん粉 at the section start.

Mechanism (`src/lib/normalize.ts`):
- `:233` `MODIFIER_PREFIXES` (30 curated modifier tokens: 加工/酸化/酵素分解/…)
- `:247` `rawTextHasCompound` — raw OCR must carry modifier+base contiguously;
  same-line whitespace is tolerated, a newline is not
- `:269` `repairBoundaryChoppedModifier` — re-prefixes ONLY the section's first
  token; no double-prefix; no graft on unrelated first tokens
- wired at `:313` (no-marker path) and `:347` (normal path) of
  `extractIngredientSection`

Evidence: class audit over 963 modifier x base pairs found **18 dangerous pairs**
(compound stricter than base) and **0 where the compound is laxer**, so a
repair can only ever surface the stricter verdict. Over-caution scan: exactly
one graft event in the whole corpus, zero cases where a bare base expected
halal got grafted. Blind-graft caveat: a false graft is theoretically possible
(name printed bare + compound elsewhere in the blob) but has **zero dev
occurrences**; it can never laxify a verdict.

Smoke section 54 pins the real off2 raw text + synthetic boundary variants
(whitespace-split, 酸化, no-compound, unrelated-first-token, no-marker path) +
verdict non-regressions.

### GT categories + AC-5 enablement

GT records now carry the protocol §2.1 `category` code. `scripts/validate-real.ts`
gains an ADDITIVE AC-5 per-category block (`gtCategory` + `ac5`/`perCategory`
report keys; nothing renamed or removed). Dev 93/93 and holdout 17/17 records
map to codes. Convention: AC-5 counts ALL GT occurrences of a category;
uncovered (harness) or uncorrelated (device) images score their occurrences as
unmatched.

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

AC-5 MUST (>= 85% each) fails every category. Unmatched is systemic
(18.8-47.3% in every category); by count SN/PM/ND lead because they hold the
most occurrences — the bottleneck is extraction, not vocabulary or
category-specific matching.

### Final metrics (session 8b)

| Set | Result |
|---|---|
| Gate (92/93 covered, 1868 occ.) | **FH 0 / FR 0**, classification **55.4%** (1035), hazard recall **58.9%** (300/509), unmatched **39.2%** (732), unknown **5.4%**, verdict **97.1%** (1005/1035) |
| Golden measure | **FH 0**, classification **55.6%**, verdict **97.1%** |
| Smoke | **1291 ALL PASS**; `npx tsc --noEmit` clean |

**Standing directive: the DEVICE ROUND is the next mandatory step.** Install
the release APK, run camera/gallery scans, pull `scan-debug.jsonl`, and measure
AC-14..AC-24. No new features or data work before it.
