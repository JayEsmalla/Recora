# Recora Implementation Status

## Baseline

- Phase 0 — repository and engineering baseline: implemented
- Phase 1 — SQLite foundation and data integrity: implemented
- Phase 2 — capture and image preparation: implementation complete; physical-device camera QA remains part of release hardening
- Phase 3 — offline OCR: implementation complete; native-device offline runtime proof remains required before the release gate
- Phase 4 — receipt reconstruction parser: next
- Phase 5 — validation and confidence: pending
- Phase 6 — review and correction: pending
- Phase 7 — history, search, and price history: pending
- Phase 8 — corpus-driven QA and hardening: pending
- Phase 9 — release-candidate polish: pending

## Phase 2 Evidence

Implemented:
- camera capture through the operating-system image capture flow
- photo-library import
- receipt-focused capture guidance
- app-private staging and retained receipt-image storage
- four-corner manual crop control
- left/right rotation
- orientation-safe image manipulation
- conservative JPEG preparation
- long-image resizing that protects receipt text width
- automatic structural quality checks for resolution, extreme compression, and unusual receipt aspect ratio
- explicit user quality confirmation for sharpness, lighting, and complete framing
- Android image-picker recovery path after activity destruction
- draft creation only after the prepared image is retained successfully

Validation:
- TypeScript passes
- ESLint passes
- automated tests pass
- Android Expo export bundles successfully

Remaining device-specific verification:
- camera permission behavior on target Android devices
- crop-handle ergonomics on small and large screens
- real thermal receipts under glare/shadow
- very long receipt memory behavior on lower-memory devices

## Phase 3 Evidence

Implemented:
- `OcrEngine` abstraction independent from parser/UI logic
- Google ML Kit on-device text recognition adapter
- Latin model only; unrelated language models are excluded from Version 1
- Android OCR model is explicitly bundled so first-use OCR does not require a model download
- stable normalized block/line/element observation IDs
- spatial bounding boxes preserved in the image coordinate system
- raw OCR text preserved separately from future normalized receipt values
- Luhn-valid full payment-card numbers are redacted before OCR text/observations are persisted; digit-bearing child elements on affected lines are also redacted
- OCR confidence remains `null` because the selected native API does not expose confidence; Recora does not fabricate a score
- persisted `ocr_runs` and `ocr_observations` evidence with receipt cascade deletion
- source image width/height persisted for restart-safe OCR
- completed OCR replaces prior OCR evidence transactionally
- OCR failure or cancellation does not create accepted purchase history or partially persist a run
- deterministic fake OCR engine for parser/integration testing
- UI can run, cancel, retry, and inspect raw offline OCR output

Native configuration evidence:
- Expo prebuild succeeds for Android
- generated Android Gradle configuration contains `ocrModels = ["latin"]`
- generated Android Gradle configuration contains `ocrUseBundled = true`
- microphone permission remains explicitly removed
- Expo SDK 57 requires iOS deployment target 16.4; Recora is configured accordingly
- Android Java/Gradle compilation could not be executed on the current REL.AI host because Java/JAVA_HOME is unavailable
- iOS native-project generation cannot run on this Windows host; it must be verified on macOS or through EAS

Validation:
- TypeScript passes
- ESLint passes
- automated migration/repository/OCR service tests pass
- Android JavaScript/Hermes export bundles successfully

## Release-gate verification still required

The following items remain mandatory before Phase 9 can be declared complete:
- physical-device camera flow
- offline OCR execution on a native Android build with networking disabled
- OCR result geometry against representative real receipts
- iOS native build verification if iOS is included in the demonstrated target set
- lower-memory long-receipt behavior
- complete corpus metrics and end-to-end acceptance suite
