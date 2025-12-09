# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Plain is a multi-platform project consisting of:
- **iOS app** (Swift/SwiftUI) at `ios/Plain/`
- **Firebase backend** (Cloud Functions, TypeScript) at `firebase/functions/`
- **Web app** (currently empty placeholder) at `web/`

## Development Commands

### Custom Slash Commands

- `/ios-build` - Build the iOS app for simulator
- `/ios-run` - Build and run the iOS app in simulator

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

## Key Notes

- The iOS app uses the bundle identifier `com.splitatomlabs.plain`
- Firebase Functions require Node.js 18
- The web directory exists but is currently empty
