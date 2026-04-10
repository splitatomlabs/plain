#!/usr/bin/env bash
# run_pipeline.sh — End-to-end pipeline wrapper for Plain content processing.
# Steps:
#   1. Chunk EPUB into JSON files
#   2. Translate chunks (manual step via Claude Code subagent — see CLAUDE.md)
#   3. Run chunk stats on generated JSON files
#
# Usage:
#   ./scripts/run_pipeline.sh [--epub <path>] [--books <comma-separated numbers>]
#
# Defaults:
#   --epub  books/pg2680-images-3.epub
#   --books 1,2

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

EPUB="${EPUB:-books/pg2680-images-3.epub}"
BOOKS="${BOOKS:-1,2}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --epub)
      EPUB="$2"
      shift 2
      ;;
    --books)
      BOOKS="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--epub <path>] [--books <comma-separated numbers>]" >&2
      exit 1
      ;;
  esac
done

cd "$REPO_ROOT"

echo "=== Step 1: Chunking EPUB ==="
echo "EPUB:  $EPUB"
echo "Books: $BOOKS"
python3 scripts/chunk_epub.py --epub "$EPUB" --books "$BOOKS"

echo ""
echo "=== Step 2: Translation (manual step) ==="
echo "Translation is performed by a Claude Code subagent using the prompt in"
echo "scripts/plain_translation_prompt.txt. Run it manually for each book chunk"
echo "JSON file in output/chunks/ to produce the corresponding _plain.json file."
echo "Example: ask Claude Code to translate output/chunks/<title>_book_1_original.json"

echo ""
echo "=== Step 3: Chunk stats ==="
CHUNK_FILES=("$REPO_ROOT"/output/chunks/*_original.json)
if [[ ${#CHUNK_FILES[@]} -eq 0 || ! -e "${CHUNK_FILES[0]}" ]]; then
  echo "No chunk JSON files found in output/chunks/ — skipping stats."
else
  python3 scripts/chunk_stats.py --input output/chunks/*_original.json
fi

echo ""
echo "=== Pipeline complete ==="
