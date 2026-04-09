# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Plain is a multi-platform project consisting of:
- **iOS app** (Swift/SwiftUI) at `ios/Plain/`
- **Firebase backend** (Cloud Functions, TypeScript) at `firebase/functions/`
- **Web app** (currently empty placeholder) at `web/`

## Development Commands

### iOS App

Build the iOS app:
```bash
xcodebuild -project ios/Plain/Plain.xcodeproj -scheme Plain -sdk iphonesimulator -configuration Debug build
```

Run tests:
```bash
xcodebuild test -project ios/Plain/Plain.xcodeproj -scheme Plain -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17'
```

Build and run in simulator:
```bash
xcodebuild -project ios/Plain/Plain.xcodeproj -scheme Plain -sdk iphonesimulator -configuration Debug build && \
xcrun simctl boot "iPhone 17" || true && \
xcrun simctl install booted ios/Plain/build/Debug-iphonesimulator/Plain.app && \
xcrun simctl launch booted com.splitatomlabs.plain
```

### Firebase Functions

Firebase Functions use TypeScript with Node.js 18. All commands run from `firebase/functions/`:

Build:
```bash
cd firebase/functions && npm run build
```

Build and watch:
```bash
cd firebase/functions && npm run build:watch
```

Run local emulator:
```bash
cd firebase/functions && npm run serve
```

Deploy to Firebase:
```bash
cd firebase/functions && npm run deploy
```

View logs:
```bash
cd firebase/functions && npm run logs
```

Interactive shell:
```bash
cd firebase/functions && npm run shell
```

## Scripts

Python and shell scripts live in `scripts/`. All commands run from the repo root unless noted.

### chunk_epub.py

Parses an EPUB and splits it into JSON chunk files (one per book) in `output/chunks/`.

```bash
python3 scripts/chunk_epub.py --epub books/pg2680-images-3.epub --books 1,2
```

- `--epub` — path to the EPUB file (default: `books/pg2680-images-3.epub`)
- `--books` — comma-separated book numbers to extract (default: `1,2`)
- Output: `output/chunks/<title>_book_<n>_original.json`

### chunk_stats.py

Reports character-count statistics and (if `plain_text` fields are present) Flesch-Kincaid readability scores for one or more chunk JSON files.

```bash
python3 scripts/chunk_stats.py --input output/chunks/*.json
```

- `--input` — one or more JSON chunk files produced by `chunk_epub.py`
- Requires `textstat` (`pip install textstat`)

### card_viewer.py

Terminal UI for reviewing original/plain chunk pairs side-by-side using curses.

```bash
python3 scripts/card_viewer.py \
  --original output/chunks/<title>_book_1_original.json \
  --plain    output/chunks/<title>_book_1_plain.json
```

- `--original` — original chunk JSON file
- `--plain` — plain (translated) chunk JSON file
- Controls: `n`/right-arrow next, `p`/left-arrow previous, `b` both, `o` original only, `t` plain only, `q` quit

### run_pipeline.sh

Convenience wrapper that runs chunk + stats end-to-end for one or more books. The translation step (Step 2) is a manual Claude Code subagent step and is not automated.

```bash
./scripts/run_pipeline.sh --epub books/pg2680-images-3.epub --books 1,2
```

- `--epub` — path to the EPUB file (default: `books/pg2680-images-3.epub`)
- `--books` — comma-separated book numbers (default: `1,2`)

## Architecture

### iOS App Structure

- `ios/Plain/Plain/PlainApp.swift` - App entry point using SwiftUI App lifecycle
- `ios/Plain/Plain/ContentView.swift` - Main view
- `ios/Plain/PlainTests/` - Unit tests
- Xcode project: `ios/Plain/Plain.xcodeproj`
- Bundle identifier: `com.splitatomlabs.plain`

### Firebase Backend Structure

- `firebase/functions/src/index.ts` - Cloud Functions entry point
- TypeScript compiled to `firebase/functions/lib/` (gitignored)
- Uses Firebase Functions v5.0 and Firebase Admin SDK v12.0
- TypeScript config enforces strict mode and modern ES2017 target

## Content Guidelines

### Plain Translation Readability
When translating or rewriting source texts (e.g. philosophy excerpts) into "plain" versions for card display, target **6th grade reading level** (Flesch-Kincaid Grade Level ~6.0, Flesch Reading Ease ~75-80). This level is low enough to scan quickly on a card but high enough to preserve reflective tone without feeling patronizing.

## Key Notes

- The iOS app uses the bundle identifier `com.splitatomlabs.plain`
- Firebase Functions require Node.js 18
- The web directory exists but is currently empty
