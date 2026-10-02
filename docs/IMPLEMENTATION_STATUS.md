# Recora Implementation Status

## Baseline

- Phase 0 — repository and engineering baseline: implemented
- Phase 1 — SQLite foundation and data integrity: implemented
- Phase 2 — capture and image preparation: implementation complete; physical-device camera QA remains part of release hardening
- Phase 3 — offline OCR: implementation complete; native-device offline runtime proof remains required before the release gate
- Phase 4 — receipt reconstruction parser: implementation complete; broader real-receipt corpus measurement remains part of Phase 8
- Phase 5 — validation and confidence: implementation complete on the controlled validation corpus; real-receipt false-mismatch measurement remains part of Phase 8
- Phase 6 — review and correction: implementation complete; physical-device review ergonomics remain part of release hardening
- Phase 7 — history, search, and price history: next
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

## Phase 4 Evidence

Implemented:
- deterministic receipt-line ordering from OCR geometry
- merchant candidate detection with merchant-profile extension points
- numeric and named date parsing without silently resolving locale-ambiguous dates
- integer-minor-unit amount extraction including peso/PHP prefixes, grouped amounts, parenthesized negatives, and trailing-minus values
- subtotal and final-total extraction with multiple-total warnings
- discount, tax/VAT, service-charge, and rounding adjustment reconstruction
- quantity/unit-price forms including `2 @ 40.00` and `2 x 40.00`
- multiline item-description reconstruction
- numeric product descriptors such as `1.5L` preserved when they are not price columns
- missing-subtotal support
- refund/return transaction-type detection
- possible duplicate item-row warnings
- explicit warnings for ambiguous dates, multiple totals, summary lines without amounts, and priced lines that cannot be reconstructed safely
- parser source traceability back to persisted OCR observation IDs
- restart-safe parsing by rebuilding parser input from persisted OCR evidence
- merchant-specific ignored-line hooks without hard-coding merchant behavior into the baseline grammar

Regression fixtures currently cover:
- common grocery receipt with quantity syntax and multiple adjustments
- numeric product descriptors
- multiline descriptions
- missing subtotal
- ambiguous date handling
- refund receipt
- duplicate-looking item rows
- total-item-count vs monetary-total disambiguation
- multiple final-total candidates
- merchant-profile ignored lines

Validation:
- focused parser/date/amount tests pass
- full `npm run check` passes
- real-receipt accuracy metrics are deliberately not claimed yet; those remain Phase 8 corpus work

## Phase 5 Evidence

Implemented:
- line arithmetic validation for quantity × unit price vs line total
- item-total sum vs explicit subtotal reconciliation
- subtotal/items plus signed discounts, taxes, service charges, and rounding vs final total
- missing-total and missing-item blocking states
- ambiguous/malformed/future date review states
- zero/negative purchase-line review state without applying that assumption to return receipts
- parser warning propagation to affected review fields
- explicit Verified / Review / Mismatch report state
- field-level confidence basis points with documented reasons
- native OCR confidence is used only when an engine actually supplies it; the current ML Kit adapter remains `null` and no OCR confidence is fabricated
- restart-safe parser + validation analysis over persisted OCR evidence

Controlled validation corpus:
- 4 intentionally valid deterministic cases
- 4 intentionally mismatched deterministic cases
- deterministic mismatch detection: 100% in this synthetic controlled corpus
- false mismatch rate: 0% in this synthetic controlled corpus
- these figures are engineering regression evidence only and are not claims about real-receipt accuracy

Validation:
- focused validation/confidence/integration tests pass
- full project validation passed before publication
- real-receipt false-mismatch measurement remains reserved for Phase 8

## Phase 6 Evidence

Implemented:
- structured receipt review for merchant, date/time, transaction type, subtotal, final total, line items, quantities, unit prices, line totals, discounts, taxes, service charges, rounding, and other adjustments
- live validation recalculation after manual edits
- explicit Verified / Review / Mismatch states using text and iconography rather than color alone
- issue list with field navigation for faster correction
- add/remove item rows and adjustment rows
- invalid editable values remain visible and cannot pollute persisted review data
- missing item name and missing line total are blocking mismatches
- non-blocking review warnings require explicit user acknowledgement before acceptance
- original retained image and raw OCR text remain available as read-only verification evidence
- review edits never overwrite raw OCR evidence
- first review is persisted immediately when structurally valid so app restart can recover it
- later review saves preserve corrected values instead of reparsing over them
- unfinished receipt recovery is exposed from the home screen
- final accepted receipt, line items, adjustments, validation states, and confidence values are written atomically
- failed child persistence rolls back final acceptance
- discard removes the unfinished receipt and dependent OCR evidence and returns the private image URI for file cleanup
- OCR observation storage IDs are namespaced by OCR run so identical logical ML Kit IDs from separate receipts cannot collide
- receipt-scoped review row IDs prevent item-row primary-key collisions across receipts

Validation:
- focused review, repository integrity, OCR isolation, and validation tests pass
- full `npm run check` passes
- Android Expo/Hermes export bundles successfully
- physical-device form ergonomics, keyboard behavior, image evidence readability, and interruption behavior remain part of Phase 8/9 device QA

## Release-gate verification still required

The following items remain mandatory before Phase 9 can be declared complete:
- physical-device camera flow
- offline OCR execution on a native Android build with networking disabled
- OCR result geometry against representative real receipts
- iOS native build verification if iOS is included in the demonstrated target set
- lower-memory long-receipt behavior
- complete corpus metrics and end-to-end acceptance suite
