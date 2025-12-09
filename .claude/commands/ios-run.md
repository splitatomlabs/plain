Build and run the Plain iOS app in the simulator.

Use the following commands:
```bash
xcodebuild -project ios/Plain/Plain.xcodeproj -scheme Plain -sdk iphonesimulator -configuration Debug build && xcrun simctl boot "iPhone 17" || true && xcrun simctl install booted ios/Plain/build/Debug-iphonesimulator/Plain.app && xcrun simctl launch booted com.plain.Plain
```
