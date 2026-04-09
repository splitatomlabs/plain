#!/usr/bin/env python3
"""
chunk_stats.py — Report statistics for chunk JSON files produced by chunk_epub.py.

Usage:
    python3 scripts/chunk_stats.py --input <json_path> [--input <json_path> ...]

For each file reports:
  - Min/max/mean/median character count
  - Distribution histogram (0-200, 200-400, 400-600, 600+)
  - Top 5 longest chunks with preview text
  - Flesch-Kincaid Grade Level and Flesch Reading Ease for plain_text (if present)
"""

import argparse
import json
import statistics
import sys
from pathlib import Path

try:
    import textstat
    TEXTSTAT_AVAILABLE = True
except ImportError:
    TEXTSTAT_AVAILABLE = False


def histogram(values, buckets):
    """Return counts for each bucket. buckets is list of (label, lo, hi) where hi=None means open-ended."""
    counts = {label: 0 for label, _, _ in buckets}
    for v in values:
        for label, lo, hi in buckets:
            if hi is None:
                if v >= lo:
                    counts[label] += 1
                    break
            elif lo <= v < hi:
                counts[label] += 1
                break
    return counts


def bar(count, total, width=30):
    filled = int(round(count / total * width)) if total > 0 else 0
    return "#" * filled + "-" * (width - filled)


def report_file(path):
    with open(path) as f:
        chunks = json.load(f)

    if not chunks:
        print(f"  (empty file)\n")
        return

    has_plain = "plain_text" in chunks[0]

    # Char count stats on original text
    char_counts = [c["char_count"] for c in chunks]
    n = len(char_counts)
    mn = min(char_counts)
    mx = max(char_counts)
    mean = statistics.mean(char_counts)
    median = statistics.median(char_counts)

    print(f"  Chunks : {n}")
    print(f"  Chars  : min={mn}  max={mx}  mean={mean:.1f}  median={median:.1f}")
    print()

    # Histogram
    BUCKETS = [
        ("0-200  ", 0, 200),
        ("200-400", 200, 400),
        ("400-600", 400, 600),
        ("600+   ", 600, None),
    ]
    counts = histogram(char_counts, BUCKETS)
    print("  Char count distribution (based on original text):")
    for label, _, _ in BUCKETS:
        c = counts[label]
        print(f"    {label}  {bar(c, n):30s}  {c:3d} ({c/n*100:5.1f}%)")
    print()

    # Longest chunks
    sorted_chunks = sorted(chunks, key=lambda c: c["char_count"], reverse=True)
    print("  Top 5 longest chunks (by original char count):")
    for i, chunk in enumerate(sorted_chunks[:5], 1):
        loc = f"book={chunk.get('book','?')} sec={chunk.get('section','?')} part={chunk.get('part','?')}"
        preview = chunk["text"].replace("\n", " ")[:100]
        print(f"    {i}. [{loc}] chars={chunk['char_count']}")
        print(f"       \"{preview}...\"")
    print()

    # Readability metrics on plain_text
    if has_plain:
        if not TEXTSTAT_AVAILABLE:
            print("  Readability: textstat not installed — skipping.\n")
            return

        fk_grades = []
        fre_scores = []
        for chunk in chunks:
            pt = chunk.get("plain_text", "").strip()
            if not pt:
                continue
            fk_grades.append(textstat.flesch_kincaid_grade(pt))
            fre_scores.append(textstat.flesch_reading_ease(pt))

        if fk_grades:
            print("  Readability of plain_text translations:")
            print(f"    Flesch-Kincaid Grade Level : min={min(fk_grades):.1f}  max={max(fk_grades):.1f}  mean={statistics.mean(fk_grades):.1f}  median={statistics.median(fk_grades):.1f}")
            print(f"    Flesch Reading Ease        : min={min(fre_scores):.1f}  max={max(fre_scores):.1f}  mean={statistics.mean(fre_scores):.1f}  median={statistics.median(fre_scores):.1f}")
            target_fkgl = sum(1 for g in fk_grades if g <= 7.0)
            target_fre = sum(1 for s in fre_scores if s >= 70.0)
            print(f"    Chunks at/below grade 7    : {target_fkgl}/{len(fk_grades)} ({target_fkgl/len(fk_grades)*100:.1f}%)")
            print(f"    Chunks with FRE >= 70      : {target_fre}/{len(fre_scores)} ({target_fre/len(fre_scores)*100:.1f}%)")
        else:
            print("  Readability: no plain_text content found.\n")
        print()


def main():
    parser = argparse.ArgumentParser(description="Report statistics for chunk JSON files.")
    parser.add_argument("--input", metavar="PATH", action="append", required=True,
                        help="Path to a chunk JSON file (may be repeated).")
    args = parser.parse_args()

    for path_str in args.input:
        path = Path(path_str)
        print(f"=" * 60)
        print(f"File: {path.name}")
        print(f"=" * 60)
        if not path.exists():
            print(f"  ERROR: file not found: {path}\n")
            continue
        report_file(path)

    print("=" * 60)
    print("Done.")


if __name__ == "__main__":
    main()
