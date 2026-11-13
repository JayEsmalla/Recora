# Recora Android Release Candidate

## Responsive UI implementation

The last mobile layout pass uses shared screen-size and system-font-scale rules in `src/ui/responsiveLayout.ts`. It covers Home, photo preparation, OCR and recovery pages, receipt review, receipt and item history, and accepted receipt detail screens.

- The app root uses the native safe-area provider and inset-aware screen container, protecting Android edge-to-edge content from status bars, gesture navigation areas, and display cutouts.
- The Home and recovery screens scroll when the screen is short or system text is large.
- Horizontal padding adapts on 320–360dp phones, ordinary phones, and tablets.
- Receipt review money/quantity fields, purchase history date filters, summary boxes and actions stack when required by the available width.
- Review save actions remain reachable, and incomplete/invalid edits can be saved as drafts without being accepted as history.
- Photo crop preview height responds to available screen height; crop corner handles use 44dp interaction targets.
- Long merchant names, prices and item descriptions can wrap instead of forcing a fixed column width.

Automated tests verify the responsive thresholds (320dp, 430dp and 800dp; enlarged system text; short/tall screens). These tests **do not substitute for visual inspection on actual devices**.

## Build distribution

Project: https://expo.dev/accounts/ywach/projects/recora

Android application ID: `com.ywach.recora`

Version: `0.1.0`, build code `1`.

Use the existing `eas.json` configuration:

- `preview`: installable, signed **APK** for direct on-device QA / internal distribution.
- `production`: Android App Bundle (**AAB**) for eventual Play Store submission, **not automatically released to a store**.

To create the test APK:

```bash
eas build --platform android --profile preview --non-interactive
```

To inspect the latest signed preview build:

https://expo.dev/accounts/ywach/projects/recora/builds/c2f0ecea-54d8-483d-9f30-af9b487cf3e4

Build ID: `c2f0ecea-54d8-483d-9f30-af9b487cf3e4` (submitted for the Android safe-area corrected source revision `814a454`). This was queued when last checked; check the build page for completion and APK availability.

When it reaches `FINISHED`, download the binary from the build page's artifact link and install it on a test device. The cloud build generated and retains Android signing credentials in the Expo account; do not commit or publish private signing files.

## Remaining release gates

1. Install the actual APK on supported Android versions and devices, including a compact phone and a low-memory phone.
2. Test system font scaling (1×, 1.3×, 1.6×), short screens, large purchase lists, keyboard focus, and Back navigation.
3. Confirm native ML Kit OCR with airplane mode enabled, multi-photo capture, review edits, restart recovery, and acceptance.
4. Run a real-receipt accuracy study and memory/cold-start benchmarks.
5. Review unresolved Expo transitive dependency advisories documented in `docs/BACKEND_STABILIZATION.md`.
6. Confirm that app signing is suitable for any future public distribution and protect the Expo account credentials. Play Store signing/upload policies must be handled separately.

Passing JavaScript, TypeScript and unit tests is not an assertion of native-device release readiness. This APK profile is for **internal testing and distribution**, not a Google Play production launch.
