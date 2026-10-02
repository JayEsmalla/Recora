# Recora Implementation Status

## Baseline

- Phase 0 — repository and engineering baseline: implemented
- Phase 1 — SQLite foundation and data integrity: implemented
- Phase 2 — capture and image preparation: implementation complete; physical-device camera QA remains part of release hardening
- Phase 3 — offline OCR: implementation complete; native-device offline runtime proof remains required before the release gate
- Phase 4 — receipt reconstruction parser: implementation complete; broader real-receipt corpus measurement remains part of Phase 8
- Phase 5 — validation and confidence: implementation complete on the controlled validation corpus; real-receipt false-mismatch measurement remains part of Phase 8
- Phase 6 — review and correction: implementation complete; physical-device review ergonomics remain part of release hardening
- Phase 7 — history, search, and price history: implemented
- Phase 8 — corpus-driven QA and hardening: implementation complete; physical real-receipt/device corpus evidence remains required
- Phase 9 — release-candidate polish: implementation complete; final release claim remains blocked on the external device/corpus gates listed below

## Phase 2 Evidence

Implemented:
- camera capture through the operating-system image capture flow
- photo-library import
- receipt-focused capture guidance
- app-private staging and retained receipt-image storage
- four-corner manual crop control
- left/right rotation
- orientation-safe image manipulation
- optional perspective/deskew geometry hook at the preprocessing boundary
- conservative JPEG preparation; automatic brightness/contrast filters are intentionally not enabled without corpus evidence that they improve thermal-text OCR
- long-image resizing that preserves aspect ratio while enforcing a hard OCR pixel/memory budget
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
- ambiguous numeric dates preserve both plausible locale interpretations instead of silently choosing one
- multiple total/subtotal candidates preserve their amount/source alternatives while the bottom-most total is selected for review
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

## Phase 7 Evidence

Implemented:
- chronological accepted-receipt history; unfinished drafts are excluded by query contract
- receipt detail with original item descriptions, reviewed totals, adjustments, validation state, retained image, and raw OCR evidence
- local item search over raw receipt names and user-assigned normalized identities
- merchant search, category filter, and inclusive date-range filtering
- built-in Version 1 categories stored in SQLite
- normalized item identities stored separately from raw receipt descriptions
- explicit item identity assignment, reassignment, and unlinking
- item purchase history and unit-price history derived only from accepted reviewed receipts
- raw-description history remains available before normalization
- deletion of an accepted receipt removes its contribution from receipt search and item/price history through relational cascade behavior
- receipt deletion requires destructive confirmation and removes the retained private image after database deletion
- conservative merchant-specific learning rules are opt-in and exact-match only
- learned rules are applied only after a receipt is accepted; they never alter raw receipt descriptions
- learned merchant rules can be reset independently of saved receipt evidence and normalized identities
- migration adds search/normalization indexes, correction-rule normalized-item linkage, categories, and an enriched accepted-price-history view
- home screen exposes purchase history as a first-class local workflow

Validation:
- focused migration, history, search, normalization, rule-learning, unlinking, deletion, and price-history tests pass
- full `npm run check` passes
- history queries are constrained to accepted receipts
- date-only upper bounds are normalized to include the complete selected day

## Phase 8 Evidence

Implemented:
- declared 10-case synthetic parser corpus covering core Version 1 layout and amount patterns
- automated critical-field accuracy and line-item exactness calculation with roadmap thresholds enforced in tests
- current controlled synthetic parser result: 100% critical-field accuracy and 100% line-item exactness
- controlled validation corpus continues to enforce 100% deterministic arithmetic-mismatch detection and 0% false mismatches on its valid synthetic cases
- network-forbidden service-level end-to-end test covering OCR -> persisted evidence -> review -> restart recovery -> acceptance -> search -> receipt reopen -> deletion
- interruption test proving a saved review draft remains excluded from accepted purchase history
- long-receipt memory hardening: OCR preprocessing now treats the pixel ceiling as non-negotiable, including extreme receipt aspect ratios
- image robustness, migration, repository, parser, validation, history, and normalization suites remain part of the full regression gate
- dedicated `npm run qa` hardening command
- QA/release evidence document explicitly separates synthetic regression metrics from unproven real-receipt accuracy

Validation boundary:
- synthetic and service-level automated evidence is implemented and passing
- real camera/ML Kit accuracy metrics still require an anonymized physical-receipt corpus and supported devices; Recora does not claim those results from synthetic fixtures

## Phase 9 Evidence

Implemented:
- real OCR progress stages for retained-image loading, local text recognition, sensitive-data redaction, evidence persistence, and completion
- OCR progress events include elapsed time for lightweight profiling without persisting receipt content in telemetry
- processing UI exposes meaningful local progress instead of a single indefinite message
- startup cleanup removes abandoned staging images and retained receipt files that have no SQLite reference
- cleanup selection is regression-tested and cleanup failure is non-fatal
- accepted receipt deletion requires destructive confirmation
- Android application backup is disabled in Expo configuration to avoid intentional Android Auto Backup of receipt data
- data/privacy/recovery documentation defines local storage, cleanup, deletion, interruption recovery, and backup boundaries
- crop image has an accessibility label and each crop corner exposes directional accessibility actions in addition to touch dragging
- very long image resizing is regression-tested against the 12-megapixel OCR budget
- README and QA documentation expose reproducible project and hardening commands

Release verification:
- TypeScript validation passes after the hardening changes
- `npm run qa` passes
- full `npm run check` passes
- Expo Doctor passes 20/21 checks after removing the invalid legacy splash configuration; the sole remaining warning is React Native Directory metadata marking `rn-mlkit-ocr` as untested on New Architecture
- Android clean prebuild succeeds
- generated Android manifest contains `android:allowBackup="false"`
- generated Android root Gradle configuration contains `ocrModels = ["latin"]` and `ocrUseBundled = true`
- local Android Java/Gradle compilation remains unavailable on the REL.AI Windows host because `java` / `JAVA_HOME` is not installed
- final Android Expo/Hermes release-candidate export succeeds after the Phase 8/9 hardening changes

## Final release-gate verification still required

The roadmap implementation is complete, but a **final release-quality claim is intentionally blocked** until the following external evidence exists:
- physical-device camera flow on the supported Android target set
- bundled native ML Kit OCR execution with networking disabled before the first scan
- OCR text and geometry checked against representative real thermal receipts
- anonymized physical-receipt corpus metrics for critical fields, line-item exactness, and false-mismatch rate
- lower-memory-device run with a very long receipt
- screen-reader/device usability pass
- iOS native build and backup-exclusion verification if iOS is included in the demonstrated target set

These are evidence-gathering gates, not unimplemented core application phases.
