#!/usr/bin/env python3
"""Generate a big product CSV for testing (not committed: files are large).

Usage:  python3 docs/test-data/generate-big-csv.py ROWS OUTPUT.csv [--duplicate-at ROW] [--bad-row ROW]
  e.g.  python3 docs/test-data/generate-big-csv.py 500000 /tmp/products-500k.csv
"""
import argparse, random

p = argparse.ArgumentParser()
p.add_argument("rows", type=int)
p.add_argument("output")
p.add_argument("--duplicate-at", type=int, help="spreadsheet row number that repeats the first id")
p.add_argument("--bad-row", type=int, help="spreadsheet row number with one value too many")
a = p.parse_args()

random.seed(42)
colors, cats = ["red", "blue", "black", "white"], ["shoes", "apparel", "bags"]
with open(a.output, "w", encoding="utf-8", newline="\n") as f:
    f.write("sku,name,price,currency,in_stock,color,category\n")
    for i in range(1, a.rows + 1):
        row_number = i + 1  # header is row 1
        sku = "SKU-0000001" if row_number == a.duplicate_at else f"SKU-{i:07d}"
        extra = ",oops" if row_number == a.bad_row else ""
        f.write(f"{sku},Product {i},{random.randint(500, 50000) / 100:.2f},USD,"
                f"{'true' if i % 3 else 'false'},{colors[i % 4]},{cats[i % 3]}{extra}\n")
print(f"wrote {a.rows:,} rows to {a.output}")
