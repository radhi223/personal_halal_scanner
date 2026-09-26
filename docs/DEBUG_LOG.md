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
