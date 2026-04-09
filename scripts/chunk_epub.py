#!/usr/bin/env python3
"""
chunk_epub.py — Parse an EPUB file and chunk it into card-sized text segments.

Usage:
    python3 scripts/chunk_epub.py --epub books/pg2680-images-3.epub --books 1,2

Output:
    output/chunks/<title>_book_<n>_original.json
"""

import argparse
import json
import os
import re
import sys

import ebooklib
from bs4 import BeautifulSoup
from ebooklib import epub

# Roman numeral pattern that marks section starts, e.g. "I.", "II.", "XIV."
ROMAN_PATTERN = re.compile(
    r'(?<!\w)'               # not preceded by a word char
    r'(M{0,4}'               # thousands
    r'(?:CM|CD|D?C{0,3})'   # hundreds
    r'(?:XC|XL|L?X{0,3})'   # tens
    r'(?:IX|IV|V?I{0,3}))'  # ones
    r'\.'                    # trailing dot
    r'(?=\s)',               # followed by whitespace
    re.IGNORECASE,
)

MAX_CHARS = 600


def roman_to_int(roman: str) -> int:
    """Convert a Roman numeral string to an integer."""
    roman = roman.upper()
    values = {'I': 1, 'V': 5, 'X': 10, 'L': 50,
              'C': 100, 'D': 500, 'M': 1000}
    total = 0
    prev = 0
    for ch in reversed(roman):
        v = values.get(ch, 0)
        if v < prev:
            total -= v
        else:
            total += v
        prev = v
    return total


def epub_item_to_text(item) -> str:
    """Extract clean plain text from an EPUB document item."""
    soup = BeautifulSoup(item.get_body_content(), 'html.parser')
    # Remove script/style nodes
    for tag in soup(['script', 'style']):
        tag.decompose()
    text = soup.get_text(separator=' ')
    # Collapse whitespace
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def _split_by_pattern(text: str, pattern: re.Pattern, max_chars: int) -> list[str]:
    """Split text into parts no longer than max_chars using the given split pattern."""
    fragments = pattern.split(text)
    parts: list[str] = []
    current: list[str] = []
    current_len = 0

    for frag in fragments:
        needed = len(frag) + (1 if current else 0)
        if current and current_len + needed > max_chars:
            parts.append(' '.join(current))
            current = [frag]
            current_len = len(frag)
        else:
            current.append(frag)
            current_len += needed

    if current:
        parts.append(' '.join(current))

    return parts


def split_at_sentences(text: str, max_chars: int = MAX_CHARS) -> list[str]:
    """
    Split text into parts no longer than max_chars, breaking at sentence
    boundaries (. ! ?) where possible. Falls back to clause boundaries
    (;:,) for long sentences, then to word boundaries as last resort.
    """
    if len(text) <= max_chars:
        return [text]

    sentence_end = re.compile(r'(?<=[.!?])\s+')
    clause_end = re.compile(r'(?<=[;:,])\s+')

    # First pass: split at sentence boundaries
    raw_parts = _split_by_pattern(text, sentence_end, max_chars)

    # Second pass: split any oversized parts at clause boundaries
    refined: list[str] = []
    for part in raw_parts:
        if len(part) <= max_chars:
            refined.append(part)
        else:
            refined.extend(_split_by_pattern(part, clause_end, max_chars))

    # Third pass: hard split at word boundaries as last resort
    final: list[str] = []
    for part in refined:
        if len(part) <= max_chars:
            final.append(part)
        else:
            words = part.split()
            current: list[str] = []
            current_len = 0
            for word in words:
                needed = len(word) + (1 if current else 0)
                if current and current_len + needed > max_chars:
                    final.append(' '.join(current))
                    current = [word]
                    current_len = len(word)
                else:
                    current.append(word)
                    current_len += needed
            if current:
                final.append(' '.join(current))

    return final


def find_book_number(text: str) -> int | None:
    """
    Try to extract a book number from text like 'THE SECOND BOOK' or
    'HIS FIRST BOOK', 'THE THIRD BOOK', etc.
    """
    ordinals = {
        'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
        'sixth': 6, 'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10,
        'eleventh': 11, 'twelfth': 12,
    }
    text_lower = text.lower()
    for word, num in ordinals.items():
        if word in text_lower and 'book' in text_lower:
            return num
    return None


def chunk_book_text(book_num: int, text: str) -> list[dict]:
    """
    Split a book's full text on Roman numeral section markers and
    sub-split any section that exceeds MAX_CHARS.
    Returns a list of chunk dicts.
    """
    # Find all Roman numeral markers in the text
    matches = list(ROMAN_PATTERN.finditer(text))
    if not matches:
        # No Roman numeral markers found; treat whole text as one chunk
        parts = split_at_sentences(text)
        return [
            {
                'book': book_num,
                'section': 1,
                'part': i + 1,
                'text': p.strip(),
                'char_count': len(p.strip()),
            }
            for i, p in enumerate(parts) if p.strip()
        ]

    chunks: list[dict] = []

    for idx, match in enumerate(matches):
        roman_str = match.group(1)
        section_num = roman_to_int(roman_str)
        if section_num == 0:
            continue  # skip empty/invalid roman numeral

        start = match.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        section_text = text[start:end].strip()

        parts = split_at_sentences(section_text)
        for part_idx, part in enumerate(parts):
            part = part.strip()
            if part:
                chunks.append({
                    'book': book_num,
                    'section': section_num,
                    'part': part_idx + 1,
                    'text': part,
                    'char_count': len(part),
                })

    return chunks


def process_epub(epub_path: str, book_numbers: list[int]) -> dict[int, list[dict]]:
    """
    Parse the EPUB and return chunks for the requested book numbers.
    Returns {book_num: [chunk, ...]}
    """
    book = epub.read_epub(epub_path)
    items = list(book.get_items_of_type(ebooklib.ITEM_DOCUMENT))

    # Map each document item to a detected book number
    item_book_map: list[tuple[int | None, str]] = []
    for item in items:
        text = epub_item_to_text(item)
        detected = find_book_number(text[:500])  # check first 500 chars for header
        item_book_map.append((detected, text))

    results: dict[int, list[dict]] = {}

    for book_num in book_numbers:
        # Find the document item(s) belonging to this book number
        matched_texts: list[str] = []
        for detected, text in item_book_map:
            if detected == book_num:
                matched_texts.append(text)

        if not matched_texts:
            print(f'WARNING: No content found for book {book_num}', file=sys.stderr)
            continue

        combined = '\n\n'.join(matched_texts)
        chunks = chunk_book_text(book_num, combined)
        results[book_num] = chunks
        print(f'Book {book_num}: {len(chunks)} chunks', file=sys.stderr)

    return results


def safe_filename(title: str) -> str:
    """Convert a title to a safe filename component."""
    return re.sub(r'[^\w\s-]', '', title).strip().replace(' ', '_')


def main():
    parser = argparse.ArgumentParser(description='Chunk EPUB into card-sized JSON segments.')
    parser.add_argument('--epub', required=True, help='Path to the EPUB file')
    parser.add_argument('--books', required=True,
                        help='Comma-separated list of book numbers to process (e.g. 1,2)')
    args = parser.parse_args()

    book_numbers = [int(b.strip()) for b in args.books.split(',')]

    epub_path = args.epub
    if not os.path.isfile(epub_path):
        print(f'ERROR: EPUB file not found: {epub_path}', file=sys.stderr)
        sys.exit(1)

    # Read the title for output filenames
    ebook = epub.read_epub(epub_path)
    title = safe_filename(ebook.title or 'unknown')

    results = process_epub(epub_path, book_numbers)

    output_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              'output', 'chunks')
    os.makedirs(output_dir, exist_ok=True)

    for book_num, chunks in results.items():
        out_path = os.path.join(output_dir, f'{title}_book_{book_num}_original.json')
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(chunks, f, indent=2, ensure_ascii=False)
        print(f'Wrote {len(chunks)} chunks to {out_path}')


if __name__ == '__main__':
    main()
