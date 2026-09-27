"""
Per-category token frequency for Japanese products.

Addresses the representativeness gap: global top-800 says little about e.g. dry
seasonings vs bottled drinks vs frozen food. Streams the OFF bulk export, keeps
en:japan products, and buckets their ingredient tokens by product category.

Usage:
  python scripts/corpus-by-category.py --csv D:/opencode/temp/off-products.csv.gz \
      --out D:/opencode/temp/jp-tokens-by-category.json --top 400
"""
import argparse
import csv
import gzip
import json
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict

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

# bucket -> substrings matched against the product's categories_tags
BUCKETS = {
    "seasoning": ["condiment", "seasoning", "sauce", "spice", "dressing", "soup"],
    "beverage": ["beverage", "drink", "water", "tea", "coffee", "juice", "soda", "beer", "wine"],
    "frozen": ["frozen"],
    "snack": ["snack", "biscuit", "cake", "confectioner", "chocolate", "candy", "sweet"],
    "dairy": ["dairy", "milk", "cheese", "yogurt", "cream", "ice-cream"],
    "noodle": ["noodle", "pasta", "ramen"],
    "prepared": ["meal", "prepared", "bento", "dish"],
    "bread": ["bread", "bakery", "viennoiserie"],
    "meat_fish": ["meat", "fish", "seafood", "poultry"],
    "plant": ["vegetable", "fruit", "cereal", "legume", "plant", "rice"],
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


def buckets_for(tags: str):
    found = set()
    for name, keys in BUCKETS.items():
        for k in keys:
            if k in tags:
                found.add(name)
                break
    return found or {"other"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--top", type=int, default=400)
    args = ap.parse_args()

    per_bucket = defaultdict(Counter)
    raw_names = {}
    global_counts = Counter()
    bucket_products = Counter()
    jp = 0
    total = 0
    start = time.time()

    with gzip.open(args.csv, "rt", encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(reader)
        i_tags = header.index("countries_tags")
        i_en = header.index("countries_en")
        i_text = header.index("ingredients_text")
        i_cat = header.index("categories_tags")
        need = max(i_tags, i_en, i_text, i_cat)

        for row in reader:
            total += 1
            if total % 500000 == 0:
                print(f"  rows {total}, jp {jp}, {time.time()-start:.0f}s", flush=True)
            if len(row) <= need:
                continue
            if "en:japan" not in row[i_tags] and "japan" not in row[i_en].lower():
                continue
            jp += 1
            buckets = buckets_for(row[i_cat])
            for b in buckets:
                bucket_products[b] += 1
            for t in tokens_from(row[i_text]):
                k = norm(t)
                if not k:
                    continue
                raw_names.setdefault(k, t)
                global_counts[k] += 1
                for b in buckets:
                    per_bucket[b][k] += 1

    def top(counter, n):
        return [[raw_names[k], c] for k, c in counter.most_common(n)]

    out = {
        "jpProducts": jp,
        "global": {"distinct": len(global_counts), "top": top(global_counts, args.top)},
        "buckets": {
            b: {"products": bucket_products[b], "distinct": len(c), "top": top(c, args.top)}
            for b, c in sorted(per_bucket.items())
        },
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=0)

    print(f"\nJP products: {jp}, global distinct: {len(global_counts)}")
    for b, d in out["buckets"].items():
        print(f"  {b:10s} products={d['products']:6d} distinct={d['distinct']:5d}")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    sys.exit(main())
