"""
Rank Japanese ingredient surface forms by how often they appear across the OFF
Japan product corpus. Used to decide WHICH catalog names to label first.

Usage:
  python scripts/rank-jp-tokens.py --csv D:/opencode/temp/off-products.csv.gz \
      --out D:/opencode/temp/jp-token-freq.json --top 800
"""
import argparse
import csv
import gzip
import json
import re
import sys
import time
import unicodedata
from collections import Counter

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
        for part in [seg] + WS_RE.split(seg):
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
    ap.add_argument("--top", type=int, default=800)
    args = ap.parse_args()

    counts = Counter()
    raw = {}
    jp = 0
    total = 0
    start = time.time()

    with gzip.open(args.csv, "rt", encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(reader)
        idx_tags = header.index("countries_tags")
        idx_en = header.index("countries_en")
        idx_text = header.index("ingredients_text")
        need = max(idx_tags, idx_en, idx_text)

        for row in reader:
            total += 1
            if total % 500000 == 0:
                print(f"  rows {total}, jp {jp}, distinct {len(counts)}, {time.time()-start:.0f}s", flush=True)
            if len(row) <= need:
                continue
            if "en:japan" not in row[idx_tags] and "japan" not in row[idx_en].lower():
                continue
            jp += 1
            for t in tokens_from(row[idx_text]):
                k = norm(t)
                if not k:
                    continue
                counts[k] += 1
                raw.setdefault(k, t)

    ranked = [[raw[k], c] for k, c in counts.most_common(args.top)]
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"jpProducts": jp, "distinct": len(counts), "top": ranked}, f, ensure_ascii=False, indent=0)
    print(f"\nJP products: {jp}, distinct tokens: {len(counts)}")
    print(f"top {args.top} -> {args.out}")
    print("sample:")
    for name, c in ranked[:25]:
        print(f"  {c:6d}  {name}")


if __name__ == "__main__":
    sys.exit(main())
