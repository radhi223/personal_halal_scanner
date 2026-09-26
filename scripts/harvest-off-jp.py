"""
Harvest Japanese ingredient surface forms from the OFF bulk export.

Why: the OFF /search API is capped at ~10 req/min and bulk looping gets you
soft-banned. The official static export is meant for this. We stream the
gzipped TSV, keep only products tagged en:japan, and pull Japanese ingredient
names from `ingredients_text` (the export has no `ingredients_text_ja` column).

Output: a token cache compatible with scripts/build-catalog.mjs.
  {"pagesDone": <huge>, "tokens": { <normalized>: <raw> }}

Usage:
  python scripts/harvest-off-jp.py --csv <path.csv.gz> --out <tokens.json>
"""
import argparse
import csv
import gzip
import json
import re
import sys
import time
import unicodedata

UA_NOTE = "HalalScannerPersonal/1.0 (personal research)"

JP_RE = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]")
DELIM_RE = re.compile(r"[\n\r、。，,．・/／|｜:：;；()（）〔〕\[\]【】「」『』]+")
WS_RE = re.compile(r"[\s\u3000]+")

STOPWORDS = {
    "原材料名", "原材料", "原料", "名称", "品名", "商品名", "内容量", "賞味期限",
    "消費期限", "保存方法", "栄養成分", "栄養成分表示", "エネルギー", "たんぱく質",
    "タンパク質", "脂質", "炭水化物", "食塩相当量", "製造者", "販売者", "製造所",
    "加工者", "輸入者", "原産国", "原産地", "添加物", "遺伝子組換え", "遺伝子組み換え",
    "一部に", "含む", "含まれ", "開封後", "常温", "直射日光", "高温多湿", "お早め",
    "召し上がり", "日本語", "賞味", "期限", "表示", "本商品", "アレルギー",
    "特定原材料", "対象", "目安", "約", "以上", "以下", "当社", "弊社", "工場",
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower()
    s = WS_RE.sub("", s)
    s = re.sub(r"[・、。，．！？「」『』【】（）〔〕［］｛｝]+", "", s)
    s = re.sub(r"[.,:;!?'\"`~^*_\-–—/\\|+=<>@#$%&]+", "", s)
    return s


def tokens_from(text: str):
    if not text:
        return
    for seg in DELIM_RE.split(text):
        seg = seg.strip()
        if not seg:
            continue
        parts = [seg] + WS_RE.split(seg)
        for part in parts:
            t = part.strip()
            t = re.sub(r"^[0-9０-９.．%％)\-–—・、\s]+", "", t)
            t = re.sub(r"[0-9０-９.．%％(（\s]+$", "", t)
            if len(t) < 2 or len(t) > 20:
                continue
            if re.search(r"[0-9０-９]", t):
                continue
            if not JP_RE.search(t):
                continue
            if norm(t) in STOPWORDS:
                continue
            yield t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    print(f"Streaming {args.csv} ...", flush=True)
    tokens = {}
    jp_rows = 0
    total_rows = 0
    start = time.time()

    with gzip.open(args.csv, "rt", encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(reader)
        idx_tags = header.index("countries_tags")
        idx_en = header.index("countries_en")
        idx_text = header.index("ingredients_text")
        need = max(idx_tags, idx_en, idx_text)

        for row in reader:
            total_rows += 1
            if total_rows % 500000 == 0:
                print(
                    f"  rows {total_rows}, jp {jp_rows}, tokens {len(tokens)}, "
                    f"{time.time()-start:.0f}s",
                    flush=True,
                )
            if len(row) <= need:
                continue
            is_jp = "en:japan" in row[idx_tags] or "japan" in row[idx_en].lower()
            if not is_jp:
                continue
            jp_rows += 1
            for t in tokens_from(row[idx_text]):
                k = norm(t)
                if k and k not in tokens:
                    tokens[k] = t

    out = {"pagesDone": 10**9, "source": "off-bulk-export", "tokens": tokens}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)

    print(f"\nDone: {total_rows} rows scanned, {jp_rows} JP products")
    print(f"tokens: {len(tokens)} -> {args.out}")
    print(f"elapsed: {time.time()-start:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
