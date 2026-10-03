# PROGRESS REPORT — personal_halal_scanner (halal scanner for Japanese food labels)

Date: 2026-10-04 (session 8b, FH-class fix + AC-5 coverage + release R4)
Repo: `D:\hls` (moved from `D:\Code\personal_halal_scanner` — Windows MAX_PATH)
Artifacts root: `D:\opencode\temp` (goldenset, v2/v3 reports)
Status vs "siap dipakai sehari-hari": **NOT YET — corpus gate passes AC-0 and
AC-1/AC-2 (FH 0 / FR 0); AC-5 is now measured and fails every category
(46.9-73.4%); accuracy/coverage thresholds still fail offline, and the device
round + the sealed holdout gate are pending. Device round is the next step.**

---

## 1. Executive summary

This is a personal Android app that scans Japanese food ingredient labels and
classifies each ingredient as **halal / haram / syubhat (doubtful) / unknown**.
It is fully offline for the core flow (no ads, no subscription, sideloaded APK).
It is a fact holder plus documented initial opinion, not a fatwa service.

Current status in one screen:

| Item | Value |
|---|---|
| Working tree | clean after this round; tree `5ab048f` + docs commit (session 8b) |
| Smoke tests | **1291 PASS / 0 FAIL** (`npm run smoke`) |
| TypeScript | `npx tsc --noEmit` clean |
| Golden DEV (expanded) | 93 images / 1869 items / 509 hazards |
| Golden HOLDOUT | sealed, 16 images (17 records) / 196 items / 47 hazards |
| Corpus totals | 109 distinct images / 110 records / ~2065 occurrences / ~556 hazards |
| AC-0 validity | **ALL PASS** (was FAIL at 38 images / 394 items / 79 hazards) |
| Gate false-halal | **0** (session 8b modifier-prefix class fix; was 1, OCR-limited) |
| Gate false-haram | **0** |
| Gate dangerous false-halal | **0** (no pork/alcohol labelled halal) |
| Classification (expanded dev) | **55.6%** golden / **55.4%** gate |
| AC-5 per category | measured; **FAIL all 8 categories** (46.9-73.4% classification) |
| Verdict accuracy among emitted | **97.1%** |
| Hazard recall | **58.9%** (300/509) |
| Strip recovery | sparse strips 8 -> 1115 chars (`off_4823077629518`, 2122x362) |
| Synthetic eval (0/15/30% OCR error) | 99.8 / 92.1 / 84.5 (19/19 assertions) |
| Curated data | 955 entries / 1237 names; 538 E-codes; 10,805 catalog; 70 rules |
| Device validation | last real-camera round 2026-09-27; new runs pending |
| Build | `assembleRelease` reproducible; install needs an attached device |

The headline change of this round is honesty of measurement: the golden set
grew from a hand-picked 21-image dev set (58% not covered) to a 93-image
expanded dev set built from 72 real Open Food Facts photos. The measured
classification dropped from 82.6% to 55.5% (55.6% after the session-8b FH-class
fix) — that drop is the corpus being
hard, not the code regressing (the original 21 images are a subset of the 93).

---

## 2. App overview

### Pipeline (photo -> verdict)

```
camera/gallery
  -> downscale label to 1600px wide (detection + full pass)
  -> ML Kit Japanese OCR detailed pass  (also yields text line frames)
  -> computeIngredientCrop(): find 原材料名 line, crop to next section
     boundary (boundary at LINE START), map rect back to original, crop
     (max 1400px wide)
  -> OCR passes:
       ML Kit full        (from the detailed pass, ~0.5 s)
       PaddleOCR crop     (~3 s precision pass, PP-OCRv5, per-line)
       PaddleOCR full     only when coverage < 180 chars (adaptive)
  -> extractIngredientSection() -> dedupe -> merge passes
  -> normalize() / tokenize / isLabelNoise()
  -> analyzeLayered(): curated > rules > fuzzy-curated > catalog
  -> findings -> result screen (banner + per-item status)
```

Timing baseline: ~3.9 s typical (2 passes), ~8 s for 3 passes; originally
~15.5 s. Strip recovery adds tiles only on sparse wide/thin photos.

### Matching layers

1. **Exact curated** (`src/data/ingredients.json`, `ecodes.json`) — always wins.
2. **Keyword rules** (`src/lib/rules.ts`, 70 hand-written rule objects).
3. **Fuzzy curated** — length-aware edit distance with a confusion map; refused
   for haram and for tokens ≤ 2 chars.
4. **Catalog** (`src/data/catalog.json`, 10,805 unreviewed names) — exact first,
   fuzzy needs >= 0.7.

### Offline behavior

- Models are on-device (ML Kit bundled by RN library; PaddleOCR model ~21 MB
  downloaded and cached on first Paddle use). First-ever run without network:
  Paddle fails, ML Kit still works (graceful failure).
- No network calls in the core scan flow.

### Screens (`src/app/`)

| Route | Purpose |
|---|---|
| `index.tsx` | Home: scan, search, Debug Scan, disclaimer, Paddle warm-up |
| `scan.tsx` | Camera / gallery capture, crop, OCR passes, progress, retry |
| `result.tsx` | Verdict banner, per-finding cards, "Tandai salah" feedback button |
| `search.tsx` | Offline database search (curated + catalog + E-codes) |
| `debug.tsx` | Read / share / clear `scan-debug.jsonl` |
| `disclaimer.tsx` | Non-fatwa disclaimer text |

---

## 3. Repository map

| Path | Owns |
|---|---|
| `src/app/*.tsx` | Expo Router screens (above) |
| `src/lib/ocr.ts` | ML Kit pass + line frames; pass orchestration |
| `src/lib/ocrPaddle.ts` | PaddleOCR PP-OCRv5 pass; strip-tile recovery caller |
| `src/lib/imagePrep.ts` | Downscale, crop+upscale, image size probe |
| `src/lib/autoCrop.ts` | Pure crop logic: section boundary, strip plan/tiles/merge |
| `src/lib/normalize.ts` | NFKC, variant folds, phrase folds, noise filter, tokenizer |
| `src/lib/matcher.ts` | analyzeLayered, exact/fuzzy, safety guards, collapse |
| `src/lib/rules.ts` | 70 keyword rules (status/category/confidence/sources) |
| `src/lib/confusion.ts` | Weighted per-character substitution costs |
| `src/lib/levenshtein.ts` | Length-aware weighted edit distance |
| `src/lib/verdict.ts` | Banner computation, effectiveStatus (unreviewed -> unknown) |
| `src/lib/database.ts` | Indexes for curated/ecodes/catalog, looksAlcoholic |
| `src/lib/scanStore.ts` | Current scan result state |
| `src/lib/debugFile.ts` | Persistent JSONL scan log (rotation cap 40) |
| `src/lib/debug.ts` | `DEBUG_VERBOSE` / HALALDBG logcat lines |
| `src/data/ingredients.json` | 955 curated entries / 1237 names (status, basis, sources) |
| `src/data/ecodes.json` | 538 E-numbers (MUIS-arbitrated) |
| `src/data/catalog.json` | 10,805 unreviewed names (taxonomy + JP tokens) |
| `src/data/addi-citations.json` | 387 ADDI provenance citations |
| `scripts/smoke.ts` | 1291 assertions, 94 numbered sections + invariant pins |
| `scripts/eval.ts` | Synthetic matching eval + 19 high-stakes assertions |
| `scripts/eval-real.ts` | Real-image batch harness (Paddle; mirrors app path) |
| `scripts/validate-real.ts` | Golden-set gate metrics (AC-1..AC-11) + report |
| `scripts/validate-ground-truth.ts` | GT schema/AC-0 quota check |
| `scripts/ocr-node.mjs` | Single-image Paddle runner in Node |
| `scripts/expand-labels.mjs` | Lexicon-driven bulk curation + audits |
| `docs/DEBUG_LOG.md` | Session/agent tuning history |
| `docs/VALIDATION_GOLDENSET.md` | Golden-set protocol results incl. expanded corpus |
| `docs/VALIDATION_BASELINE.md` | Earlier label-only baseline |
| `HANDOVER.md` | Operational handover (gitignored) |
| `android/` | Generated by prebuild (CNG), not committed |

---

## 4. Data inventory

| Dataset | Count | Notes |
|---|---|---|
| Curated entries | **955** | 1237 names: 816 halal / 128 syubhat / 11 haram; all with confidence/basis/reviewed/sources |
| Modified-starch curated entry | 1 | 23 names incl. 加工でん粉 / 酸化デンプン / 加工プン / 加工アンプン / 加工デンナン (syubhat) |
| E-codes | **538** | MUIS Food Additive Listing arbiter + HalalLens + SuhasDissa cross-check |
| Catalog | **10,805** | 5,619 taxonomy + 5,186 JP label tokens (Open Food Facts, ODbL) |
| ADDI citations | 387 | ADDI Lab / ITS Surabaya RDF (ODbL) |
| Keyword rules | **70** | `id: '...'` CurationRule objects in `src/lib/rules.ts` |
| Smoke assertions | **1291** | all PASS |

### Policy summary (HANDOVER §6)

- Default halal; **haram only when explicit** (pork and derivatives, khamr).
- When in doubt -> **syubhat**, never forced halal.
- Source-dependent -> syubhat: gelatin/collagen, rennet/pepsin/enzymes,
  L-cysteine, emulsifiers/monoglycerides/glycerin/shortening/margarine/fat
  spreads, mirin/料理酒/酒粕, cochineal (E120 — scholars differ).
- Meat (beef/chicken/lamb) -> syubhat by default (no shariah slaughter
  assurance / no halal mark in Japan). Pork -> haram. Fish/seafood, plants,
  minerals -> halal. 大豆レシチン halal; generic レシチン syubhat.
- E-numbers: MUIS is the arbiter; conflicts -> syubhat and both positions shown.
- OFF `vegan=yes` may grant low-confidence halal but never overrides a rule;
  unreviewed vegan entries are displayed as unknown (`effectiveStatus`).

### Sources

Qur'an; LPPOM MUI; KMA No. 1360/2021 (BPJPH); JAKIM MS1500:2019; MUIS Food
Additive Listing (Singapore, 13 Sep 2016); EFSA; Open Food Facts JP (ODbL);
HalalLens (CC-BY-4.0); SuhasDissa (GPL-3.0, internal only); ADDI (ODbL).
LPPOM "Positive List" is never displayed as "HALAL".

---

## 5. Safety invariants and their smoke guards

| Invariant | Meaning | Pinned in smoke |
|---|---|---|
| Fuzzy never yields haram | an approximate match cannot produce a haram verdict; haram needs exact/rule | §34 (`fix34` block: plant/fish extracts NOT haram; exact pork extracts still haram) |
| Haram is exact-only | curated haram terms match exactly; 2-char tokens exact-only | §4, §24, §34 |
| Haram-shadow guard | fuzzy is refused when the token is within edit distance of a curated haram term | §24/§34 regression set |
| Rule beats fuzzy-curated | approximate curated hit must not shadow an explicit rule | §9/§31 order-lock |
| Layer order | exact curated > rules > fuzzy curated > catalog | §3, §7, §9, §31 |
| Strictest-wins on duplicates | duplicate normalized names resolve to the strictest status (44 E-code conflicts; 加工デンプン was halal via a conflicting entry) | device-round pins + §30 |
| effectiveStatus | unreviewed OFF vegan halal entries count as unknown, no green banner | §7, §11 |
| Meat classes | any token containing 豚 is haram (海豚/河豚 excluded); 鶏/牛/羊 species rules; unidentified cuts -> syubhat meat-cut | §15, §16, §34 |
| Meat mention count | a token with ONE animal mention + a non-claim marker is dropped; anything else stays an ingredient claim | §15/§16 |
| Vitamin anchoring | `^v[ce](\d{1,2})?$` only — VEAL/VERMOUTH can never be halal:vitamin | §50n |
| Modified starch | `rule:modified-starch` ordered before generic starch/thickener halal rules | §52/§53 |
| Modifier-prefix boundary repair | boundary-chopped modifier+base first token restored only when the raw OCR carries the compound; 963-pair audit 18 dangerous / 0 laxer (never laxifies a verdict) | §54 |

---

## 6. Metrics history

| Session / set | Classification | Verdict acc. | OCR variant | Unknown | Unmatched | FH / FR | Smoke |
|---|---|---|---|---|---|---|---|
| First golden measurement (12 img / 166 items, 2026-09-27) | 66.9% | 83.8% | 80.1% | 33.1% | — | 0 / 0 | ~800 |
| Device round (4 camera scans + 7 verifier rounds) | **83.7%** | 86.3% | — | 16.3% | — | 0 / 0 | ~990 |
| DEV carved, 21 img / 201 items (2026-10-03 G-round) | 82.6-82.8% | 95.2-95.7% | 80.1-80.8% | ~17% / 3.0% harness | 14.5% | 0 / 0 | ~1,120 |
| Gate tool on 21-dev | 82.5% | — | — | — | 14.5% | 0 / 0 | — |
| **Expanded DEV, 93 img / 1869 items** golden measure | **55.5%** | **97.0%** | **56.4%** | 44.5% (96 catalog + 735 unmatched) | — | **1 / 0** | 1272 |
| **Expanded DEV**, gate tool (92/93 covered, 1868 occ.) | **55.3%** | **97.0%** | 56.2% | **5.4%** | **39.3%** | **1 / 0** | 1272 |
| **Expanded DEV**, gate tool + FH-class fix (session 8b, 92/93 covered, 1868 occ.) | **55.4%** | **97.1%** | 56.2% | **5.4%** | **39.2%** | **0 / 0** | **1291** |
| **Expanded DEV**, golden measure after FH-class fix (session 8b) | **55.6%** | **97.1%** | — | — | — | **0 / 0** | **1291** |
| Synthetic eval (300 labels, 0/15/30% error) | — | — | recall 99.8 / 92.1 / 84.5 | unknown 0.2/3.2/5.9 | unmatched 0.0/4.6/9.7 | 0 / 0 | 19/19 assertions |

Why the expanded number is lower — and why it is the honest number:

- The 72 new images are real OFF user photos: curved bottles, glare, small
  print, multi-column panels, imported/foreign labels, and wide strips. The
  original 21 were selected for legibility.
- The original 21 images are a strict subset of the 93, so the expanded metric
  is the conservative measurement of the same code.
- The collapse in classification comes overwhelmingly from OCR/extraction
  coverage (unmatched 39.2%), not from wrong verdicts: among emitted verdicts
  the app is still right 97.1% of the time.
- Synthetic eval and corpus-frequency coverage (87.7%) remain **upper bounds**
  only, never validation evidence.

False-halal progression after the expanded GT was built:
**36 -> 33 (after GT normalization/alignment) -> 5 (FIX-B) -> 1 (FIX-C) -> 0
(session 8b modifier-prefix class fix)**. The former remaining case was
OCR-limited (below); it is now fixed as a class.

---

## 7. Validation protocol status (AC-0 .. AC-25)

Protocol: `validation-protocol.md` (thresholds fixed 2026-09-27, before the
first run). All device-dependent criteria are still pending; the offline harness
explicitly cannot measure ML Kit, the adaptive third pass, camera optics, or the
MB-based crop.

### AC-0 — corpus validity: ALL PASS

| # | Requirement | Target | Minimum | Actual | Verdict |
|---|---|---|---|---|---|
| AC-0a | Golden-set images | 96 | 64 | 110 records (93 dev + 17 holdout; 109 distinct images) | PASS |
| AC-0b | GT occurrences | >= 1,100 | >= 500 | 2,065 | PASS |
| AC-0c | High-risk occurrences | >= 150 | >= 90 | 556 (509 dev + 47 holdout) | PASS |
| AC-0d | Holdout | 24 images | 16 | 16 images / 17 records, sealed | PASS (minimum) |
| AC-0e | Real photos | >= 60 | >= 40 | 110/110 | PASS |

### AC-1 .. AC-25 — dev-only status (holdout untouched)

| # | Criterion | Current (dev) | Target | Status |
|---|---|---|---|---|
| AC-1 | False-halal pooled | 0 | 0 | **PASS** (session 8b FH-class fix) |
| AC-1a | Dangerous FH (expected haram) | 0 | 0 | PASS |
| AC-1b | Policy FH (expected syubhat) | 0 | 0 | PASS |
| AC-2 | False-haram | 0 | 0 | PASS |
| AC-3 | Haram-by-fuzzy | 0 (invariant; audit fuzzy violations 0) | 0 | PASS |
| AC-4 | Token recall (extraction) | 56.2% (variant) | >= 90% | FAIL |
| AC-5 | Per-category recall | measured: 46.9-73.4% (all 8 categories below bar) | >= 85% each | **MEASURED — FAIL all** |
| AC-6 | Verdict yield | ~55.4% | >= 90% | FAIL |
| AC-7 | Unknown rate | 5.4% | <= 3% | FAIL |
| AC-8 | Unmatched rate | 39.2% | <= 7% | FAIL |
| AC-9 | High-risk recall | 58.9% (300/509) | >= 95% | FAIL |
| AC-10 | E2E correct recall | 53.8% | >= 85% | FAIL |
| AC-11 | Verdict accuracy among emitted | 97.1% | >= 97% | PASS |
| AC-12 | Over-caution T2 | 1.3% (24) | <= 3% | PASS |
| AC-13 | Noise leakage | 31.2% (455/1457) | <= 2% | FAIL |
| AC-14 | Section CER (merged) | not measured offline | <= 10% | PENDING device |
| AC-15 | Harness OCR sanity (CER) | not reported by current harness | <= 15% | PENDING |
| AC-16..18 | OCR p50/p90/max | last device round ~3.9 s typical | <= 5 / 9 / 15 s | PENDING device |
| AC-19 | End-to-end p50/p90 | last device round ~4-8 s | <= 6 / 10 s | PENDING device |
| AC-20 | Crash-free scans | — | 0 over >= 100 scans | PENDING device |
| AC-21 | Graceful Paddle failure | behavior exists (ML Kit fallback) | <= 2 scans | PENDING device |
| AC-22 | Offline 10 scans | first-run Paddle download known | 10/10 | PENDING device |
| AC-23 | Regression | smoke 1291 PASS; eval 19/19 | all pass | PASS |
| AC-24 | No record loss | rotation cap 40; pull <= 30 scans/run | MUST | PENDING device (operational) |
| AC-25 | 20 real purchase checks | — | 0 dangerous contradictions | PENDING |

The gate as a whole: **FAIL** (as expected at this stage). The failure is
coverage/hazard-recall on hard real photos (AC-4/6/8/9/10/13) and AC-5
per-category recall; safety direction is now clean (0 FH, 0 FR, 0 dangerous
FH) and verdict correctness among emitted is 97.1%.

### The former single false-halal (fixed in session 8b)

| Image | GT | App (pre-fix) | Entry | Root cause |
|---|---|---|---|---|
| `off2/off2_4902715927824_ingredients.jpg` | 加工でん粉 (syubhat) | halal | `rule:starch` (matched `でん粉`) | Strip-recovery OCR + section boundary cut the `加工` prefix; the bare `でん粉` correctly maps to plain-starch halal. Matcher and `rule:modified-starch` never see the prefix. |

Classification: **OCR/EXTRACT gap**, not rule/data/matcher. Fixed as a CLASS in
session 8b: `repairBoundaryChoppedModifier` (`src/lib/normalize.ts`) re-prefixes
the section's first token only when the raw OCR carries a known modifier+base
compound contiguously; the 963-pair audit found 18 dangerous pairs (compound
stricter) and 0 laxer, so a repair never laxifies. Gate + golden false-halal
now 0; smoke §54 pins the case. See `docs/DEBUG_LOG.md` session 8b.

---

## 8. Agent round history

Autonomous rounds 2-10 (verifier-per-round) established the matcher invariants
and the bulk `exp:*` expansion: coverage 79.1% -> 87.7%, unknown 2.6% -> 0.1%,
smoke grew to ~800+.

| Agent | Round | What it found / changed |
|---|---|---|
| E1-E5 | 2026-10-03 evaluation cluster (5 of the 8 evaluation agents; artifacts consolidated) | Found the vitamin bare `/ve|vc/` false-halal (VEAL -> halal:vitamin, VERMOUTH -> halal), plus rule/data gap lists that became F1-F8 |
| F1 | implementation | Library/logic fix general; vitamin Latin forms anchored whole-token |
| F2 | implementation | UX: honest banner, retry state, guidance, torch, feedback loop |
| F3 | implementation | Data: surgical curated fixes (incl. modified-starch handling) |
| F4-F7 | implementation | GT transcription + consistency batches (new-gt b1-b3: 26 records / 228 items) and annotation fixes (消泡剤 split) |
| F8 | implementation | Gate tooling: GT validator + `validate-real.ts` run reporter |
| G1 | release | Pre-release audit/cleanup (noise/boilerplate checks) |
| G2 | release | Harness/validate on 21-dev; documented semantic overrides (6 images) |
| G3 | release | Gate run + per-image table; consolidated fail list |
| G4 | release | Vitamin fix verification (VEAL/VERMOUTH -> unknown, not halal); smoke §50n |
| G5 | release | 5 commits + docs + release APK build |
| P1 | expanded round | Harvested 72 hazard-heavy OFF-JP panels (24.5 MB; 569 OFF-text hazard occurrences) |
| P2a/P2b | expanded round | Scanned 54 `kind=unknown` images; 0 new usable ingredient panels |
| P3 | expanded round | Pre-harvest label probe: matched 373 / unmatched 159 / unknown 34 |
| P4 | expanded round | First harness on the new pool (21-dev subset): classification 86.0%, hazard 81.8%, unknown 2.0%, unmatched 12.0%, FH 0 / FR 0 |
| T1-T8 | expanded round | Hand-transcribed the 72 images in 8 batches of 9: **1455 items** (152/144/196/185/252/194/158/174), 433 hazards |
| M1 | expanded round | Mirrored app path in harness (strip retry + findings); merged GT: classification 54.2%, hazard 54.3%, unmatched 41.1%, unknown 4.7%, FH 36 (pre-normalization) |
| FIX-A | fix round | Data: deleted 3 bogus `exp:` modified-starch entries; +31 EN entries; curated count 955; 1 residual conflict (sodiumcaseinate) |
| FIX-B | fix round | Rules: `/ポ一ク/`, `/マ一ガリ/`, `rule:cream-cheese`, `/クー三グパウダ/`, `rule:modified-starch` ordering; FH 36 -> 5 |
| FIX-C | fix round | OCR folds (ポ一ペ一ス/ポ一ク/ポエキ/チンエキス/ビ一工ス/加工次增粘多理规查料着鱼料) + whitespace-strip-first; FH 5 -> 1; zero-collision probes |
| V1 | verification | Independently rescored 20/93 (P4 harness): 86.0/81.8, FH/FR 0; data audit 958 entries: 0 dup ids, 2 curated collisions, 0 fuzzy violations, 0 cheap-pair violations, 1 fuzzy-halal-from-haram-mutation probe |
| V2 | verification | Full expanded run + gate + golden measure + strip/fold probes; 92/93 covered, FH 1 / FR 0, classification 55.3%, hazard 58.5%, verdict 97.0%; smoke 1272 PASS; eval 99.8/92.1/84.5 |

---

## 9. Known limitations and open risks

1. **Former 1 OCR-limited false-halal (fixed)** — `off2_4902715927824`
   加工でん粉 became halal via `rule:starch` because the `加工` prefix was cut
   at the section boundary. Fixed as a class in session 8b (modifier-prefix
   boundary repair); gate + golden false-halal now 0. Blind-graft theoretical
   over-caution remains: a repair could in theory re-prefix a genuinely bare
   first token when the compound appears elsewhere in the raw blob. The class
   audit shows a graft can only ever produce the stricter compound verdict
   (18 dangerous pairs / 0 laxer), and the over-caution scan found exactly one
   graft event corpus-wide with **zero dev occurrences** of a bare base
   expected halal being grafted.
2. **Harness fidelity** — the offline harness runs PaddleOCR only. ML Kit, the
   adaptive 3rd pass, camera optics and MB-based crop are not measurable
   offline; device runs (AC-14..AC-24) are required before any pass claim.
3. **Unverified device paths** — no device validation since 2026-09-27. The
   expanded corpus has never been scanned on the phone; latency, crash-free,
   offline, and mixed-engine merge behavior on the new categories are unknown.
   **The device round is the next mandatory step.**
4. **E1421 / E1520 MUIS-only codes** — E1520 (Propylene Glycol) is syubhat with
   MUIS as its only source; E1421 is halal from MUIS plus a community source
   whose alias reads "trimetaphosphate or phosphorus". These two rest on a
   single certifier; no second independent confirmation exists in the dataset.
5. **Corpus source bias** — the expanded GT is OFF/OFF2 user photos plus
   Commons; products without photos and many retail categories are missing.
   GT records now carry the protocol category field, so AC-5 is measured
   (46.9-73.4% classification; all 8 categories fail the 85% bar); 1 GT image
   (`commons/commons_8752933.jpg`) has no harness record.
6. **Residual data issues** — sodiumcaseinate status conflict
   (syubhat/halal across sources), 2 curated name collisions, and the V1-audit
   fuzzy-halal-from-haram-mutation probe case (wine -> grape) are logged but
   unfixed; noise leakage 31.2% means findings still attach to non-GT text.

---

## 10. Remaining path to the gate

1. **Device round FIRST (mandatory)** — install the release APK, run
   camera/gallery scans across categories, pull `scan-debug.jsonl` (cap 40;
   pull after <= 30 scans or raise the cap), and feed `validate-real --mode
   device`. Measure AC-14..AC-24: latency (AC-16..19), crashes (AC-20), Paddle
   fallback (AC-21), offline (AC-22), CER (AC-14/15). **No new features or data
   work before this step.**
2. **Extraction robustness** — close AC-4/6/8/9/10 and lift AC-5: strip/crop
   handling on curved and multi-column labels, confusion pairs, and targeted
   data coverage for the remaining unmatched clusters. AC-13 noise leakage
   needs matcher/extraction tightening. Device data from step 1 sets the
   priorities.
3. **Sealed holdout final run** — open once when dev converges (Phase 6), apply
   §1.5, and burn the holdout only if a fix is authored after seeing its
   output. Holdout stays sealed until then.
4. **AC-25 trial** — 20 real shopping/purchase checks with the frozen APK,
   logging contradictions; declare daily-use only if 0 dangerous events.
5. **Optional new photos** — no longer required for AC-0 (corpus now passes).
   More photos would still help category balance and AC-5, and the protocol
   allows expanding up to 96/24; the quota option remains, not a blocker.

---

## 11. Commit history

Working tree history (oldest -> newest):

```
205cc7a Initial commit
cc1fedb Add halal ingredient scanner app (Expo + React Native)
7e69d97 docs: add comprehensive README
14f72aa fix(ocr): auto-crop to 原材料名 region + accuracy fixes
18c342f feat(ocr): hybrid multi-pass OCR (full label + cropped region)
a0d6798 fix(rules): handle truncated-first-char OCR variants
956fb92 perf(ocr): 3-pass hybrid pipeline
04af432 perf(ocr): downscale crop + adaptive full-label pass
efbd64c chore: gitignore local opencode rules
51e7a89 revert(ocr): stop forcing NNAPI-only
5c54122 feat(matcher): OCR confusion map
8efbce8 feat(matcher): extend confusion pairs and truncated-token rules
5575f36 feat(rules): cover truncated/variant OCR forms and more label noise
dd1b3b9 fix(rules): palm-oil long-vowel variant + lemongrass
cb8cac6 feat(debug): persistent scan debug log + Debug screen
733b070 chore: gitignore local HANDOVER.md
d1f9167 feat(ui): low-quality photo hint + palm-oil stray-char variant
e84b4b4 docs(debug): log persistent-log screen, hint, photo-variance check
bf02c10 feat(feedback): mark-wrong button + representativeness caveat
df68554 feat(rules): rounds 2-4 autonomous accuracy passes
626c4e2 fix(rules): repair 7 misclassification bugs (verifier)
f988268 fix(rules): repair round-5 regressions
cc3f556 fix(matcher): fuzzy matching must never yield a haram verdict
83c44f0 fix(rules): restore wine verdict and close latent haram gaps
1eec38f fix(matcher,rules): rule beats fuzzy-curated; alcohol false positives
f2f3a1f fix(rules): cocktail sauce not khamr; fermented seasoning caution
dffdd39 docs(debug): record autonomous iteration (rounds 2-10) + invariants
6b6a311 feat(data): expand labelled coverage to 2,018 entries + OCR research fixes
92d0d7e feat(validation): real-image baseline, honest banner, false-verdict fixes
393c6fe feat(validation): golden-set metrics, offline search, extraction/crop fixes
d362723 fix(safety): meat-cut false halal, dropped meat claims, unreviewed banner
e4e92c0 fix(safety): cover real meat-cut names; cut-rule false positives
7c5bad6 fix(safety): pork-token priority, katakana cuts, dish names
adef81c docs: record the 2026-09-27 device round and verifier findings
bb43d54 fix(safety): OCR garble folds, English labels, single-char ingredients
b5aa3fe feat(ux): honest banner, retry state, guidance, first-run, torch, feedback
03ba8f2 fix(data): trustworthy E-codes, hermetic catalog, surgical curated fixes
6de3af3 test: pin the 2026-10-03 agent round (sections 50, banner, data baselines)
a65d643 feat(validation): gate tooling (GT validator + run reporter)
e4d9d62 docs: golden two-set structure, dev metrics, agent-round record
6b723e5 feat(ocr): strip-tile recovery + faithful harness (strip retry, tile800, alignment)
6e9c990 fix(data): English curated set, modified-starch variants, OCR folds, meat-extract gaps
34b69d7 docs: expanded-corpus validation, agent-round log, full progress report
5ab048f fix(extraction): modifier-prefix boundary repair + AC-5 per-category reporting
<docs commit> docs: AC-5 rollout, FH-class fix, session 8b record
```

All session-8 commits pushed to `origin/main`.

---

## 12. Environment notes

- **Repo path: `D:\hls`** — moved from `D:\Code\personal_halal_scanner` because of
  Windows MAX_PATH limits. Any `D:\Code\...` path in older docs/scripts is stale.
- Node 22.13.1, npm 11.1.0; Gradle 9.3.1; JDK 21
  (`C:\Program Files\Android\Android Studio\jbr`); JDK 23 breaks Gradle 9.
- Expo SDK 57, RN 0.86.3, React 19.2.3, TypeScript ~6.0.3.
- **Disk C: is nearly full** — keep build outputs and caches on D:.
- Build (`D:\hls\android`):

  ```powershell
  $env:ANDROID_HOME = "C:\Users\Radhi\AppData\Local\Android\Sdk"
  $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
  $env:GRADLE_USER_HOME = "D:\opencode\.gradle"
  $env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
  cd D:\hls\android
  .\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain --no-daemon
  ```

  APK: `D:\hls\android\app\build\outputs\apk\release\app-release.apk`
  (debug-keystore signed, installable via `adb install -r`).
- Tests / validation:

  ```powershell
  npm run smoke            # 1291 assertions
  npx tsc --noEmit
  npx tsx scripts/eval.ts  # synthetic eval, 19/19 assertions
  npx tsx scripts/validate-real.ts --mode harness `
    --harness D:/opencode/temp/v2-harness.json `
    --gt D:/opencode/temp/goldenset/golden/dev/dev.json `
    --out D:/opencode/temp/v2-report.json
  ```

- `android/` is regenerated with `npx expo prebuild --platform android --clean`;
  `scripts/fix-ort.mjs` (postinstall) patches ORT for Gradle 9;
  `plugins/withOnnxruntimePackage.js` registers the ORT native package.
- Temp artifacts for this round: `D:/opencode/temp/v2-*`, goldenset under
  `D:/opencode/temp/goldenset/`.
- Never round-trip UTF-8 files through PowerShell `Get-Content`/`Set-Content`
  (corrupts Japanese); use the editor tools. Commit messages with path-like
  tokens must go through `git commit -F <file>`.
