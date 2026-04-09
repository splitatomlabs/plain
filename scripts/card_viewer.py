#!/usr/bin/env python3
"""
card_viewer.py — Interactive CLI card viewer for Plain translation review.

Usage:
    python3 scripts/card_viewer.py --original <original.json> --plain <plain.json>

Controls:
    Right arrow / n   Next card
    Left arrow / p    Previous card
    o                 Show original text only
    t                 Show plain translation only
    b                 Show both (default)
    q                 Quit
"""

import argparse
import curses
import json
import sys
import textwrap


def load_json(path: str) -> list:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError(f"Expected a JSON array in {path}")
    return data


def wrap_text(text: str, width: int) -> list[str]:
    """Wrap text to the given width, preserving paragraph breaks."""
    paragraphs = text.split("\n")
    lines = []
    for para in paragraphs:
        if para.strip() == "":
            lines.append("")
        else:
            lines.extend(textwrap.wrap(para, width) or [""])
    return lines


def draw_card(stdscr, index: int, total: int, chunk: dict, mode: str) -> None:
    stdscr.clear()
    height, width = stdscr.getmaxyx()
    max_text_width = min(width - 4, 80)

    book = chunk.get("book", "")
    section = chunk.get("section", "")
    part = chunk.get("part", "")
    original_text = chunk.get("text", "")
    plain_text = chunk.get("plain_text", "")

    # Build metadata string
    meta_parts = []
    if book:
        meta_parts.append(f"Book {book}")
    if section:
        meta_parts.append(f"Section {section}")
    if part:
        meta_parts.append(f"Part {part}")
    meta = " | ".join(meta_parts) if meta_parts else "Unknown location"

    position = f"{index + 1}/{total}"

    row = 0

    def safe_addstr(r: int, c: int, text: str, attr: int = 0) -> int:
        """Add string clipped to screen bounds; return next row."""
        if r >= height - 1:
            return r
        try:
            stdscr.addstr(r, c, text[:width - c - 1], attr)
        except curses.error:
            pass
        return r + 1

    # Header: position and metadata
    header = f"  {position}  {meta}"
    row = safe_addstr(row, 0, header, curses.A_BOLD)
    row = safe_addstr(row, 0, "-" * min(width - 1, 80))

    def add_section(title: str, text: str, start_row: int) -> int:
        r = start_row
        r = safe_addstr(r, 0, "")
        r = safe_addstr(r, 2, title, curses.A_UNDERLINE | curses.A_BOLD)
        r = safe_addstr(r, 0, "")
        for line in wrap_text(text, max_text_width):
            r = safe_addstr(r, 2, line)
        return r

    if mode in ("both", "original"):
        row = add_section("ORIGINAL", original_text, row)

    if mode == "both" and plain_text:
        row = safe_addstr(row, 0, "")
        row = safe_addstr(row, 0, "  " + "- " * min(38, (width - 4) // 2))

    if mode in ("both", "plain") and plain_text:
        row = add_section("PLAIN", plain_text, row)
    elif mode == "plain" and not plain_text:
        row = safe_addstr(row, 0, "")
        row = safe_addstr(row, 2, "(no plain_text field available)")

    # Footer
    footer_row = height - 2
    controls = " n/-> next  p/<- prev  o original  t plain  b both  q quit "
    if footer_row > row:
        try:
            stdscr.addstr(footer_row, 0, controls[:width - 1], curses.A_REVERSE)
        except curses.error:
            pass

    stdscr.refresh()


def run_viewer(stdscr, chunks: list) -> None:
    curses.curs_set(0)
    stdscr.keypad(True)

    total = len(chunks)
    index = 0
    mode = "both"  # "both" | "original" | "plain"

    draw_card(stdscr, index, total, chunks[index], mode)

    while True:
        key = stdscr.getch()

        if key in (ord("q"), ord("Q")):
            break
        elif key in (curses.KEY_RIGHT, ord("n"), ord("N")):
            if index < total - 1:
                index += 1
        elif key in (curses.KEY_LEFT, ord("p"), ord("P")):
            if index > 0:
                index -= 1
        elif key in (ord("o"), ord("O")):
            mode = "original"
        elif key in (ord("t"), ord("T")):
            mode = "plain"
        elif key in (ord("b"), ord("B")):
            mode = "both"
        elif key == curses.KEY_RESIZE:
            pass  # redraw on resize

        draw_card(stdscr, index, total, chunks[index], mode)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Interactive CLI card viewer for Plain translation review."
    )
    parser.add_argument(
        "--original",
        required=True,
        metavar="<json>",
        help="Path to original chunks JSON file.",
    )
    parser.add_argument(
        "--plain",
        required=True,
        metavar="<json>",
        help="Path to plain-translated chunks JSON file.",
    )
    args = parser.parse_args()

    try:
        original_chunks = load_json(args.original)
    except (FileNotFoundError, ValueError) as e:
        print(f"Error loading original file: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        plain_chunks = load_json(args.plain)
    except (FileNotFoundError, ValueError) as e:
        print(f"Error loading plain file: {e}", file=sys.stderr)
        sys.exit(1)

    if len(original_chunks) != len(plain_chunks):
        print(
            f"Warning: original has {len(original_chunks)} chunks, "
            f"plain has {len(plain_chunks)} chunks. Pairing by index.",
            file=sys.stderr,
        )

    # Merge: use plain chunks as base (they have plain_text), but ensure
    # original text is taken from the original file for fidelity.
    count = min(len(original_chunks), len(plain_chunks))
    merged: list[dict] = []
    for i in range(count):
        chunk = dict(plain_chunks[i])
        chunk["text"] = original_chunks[i].get("text", chunk.get("text", ""))
        merged.append(chunk)

    if not merged:
        print("No chunks to display.", file=sys.stderr)
        sys.exit(1)

    curses.wrapper(run_viewer, merged)


if __name__ == "__main__":
    main()
