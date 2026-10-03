# Recora Development Roadmap

> **Implementation status:** Phases 0–9 are implemented. Final release-quality claims remain gated by physical-device and real-receipt evidence that cannot be produced by repository automation alone. See [Implementation Status](IMPLEMENTATION_STATUS.md) and [QA and Release Evidence](QA_AND_RELEASE.md).

## Product Contract

Recora is an offline-first mobile receipt reconstruction and purchase tracking application.

Core pipeline:

```
Capture -> Preprocess -> OCR -> Reconstruct -> Validate -> Review -> Store & Track
```

The product is successful only when it reliably converts a supported printed receipt into a reviewed, structured, searchable local record while exposing uncertainty instead of silently accepting extraction errors.

### Non-negotiable constraints

- Core scanning, OCR, parsing, validation, review, save, search, and history work without internet.
- Receipt data and retained images remain local unless the user explicitly exports or shares them.
- Primary use requires no account.
- Raw OCR evidence is preserved separately from normalized organizational values.
- Persisted currency uses integer minor units, never binary floating point.
- UI code does not own parsing, validation, or persistence rules.
- Saving is transactional and only accepted/reviewed records become purchase history.
- A failed or interrupted scan must never become a completed receipt.
- Sensitive payment strings must not be stored as full card numbers.
- Banking, payments, cloud-account requirements, social features, rewards, ads, tax filing, full budgeting, online price scraping, and enterprise expense workflows are outside Version 1.

## Technical Direction

### Client

- Expo / React Native
- TypeScript
- Local-first application architecture
- App-private receipt image storage
- Native on-device OCR adapter behind an interface

### Local data

- SQLite as the source of truth for structured records
- Foreign keys and transactions enabled
- Schema migrations are explicit and tested
- Currency stored as integer minor units
- Derived history rebuilt/queryable from reviewed source records
- Search indexes target merchant, date, normalized item, category, and raw item text

### Processing boundaries

```
Presentation
  -> application/use-case services
    -> CaptureService
    -> ImagePreprocessor
    -> OcrEngine
    -> ReceiptParser
    -> ConfidenceEngine
    -> ValidationEngine
    -> NormalizationService
    -> ReceiptRepository
    -> Search/History services
```

No presentation component may directly implement receipt parsing or SQL.

## Delivery Phases

### Phase 0 - Repository and engineering baseline

Purpose: make development reproducible before feature work.

Deliverables:
- Expo TypeScript project
- lint/typecheck/test commands
- source folder boundaries
- environment-free offline baseline
- project roadmap and architecture notes
- Git repository connected to `JayEsmalla/Recora`

Exit gate:
- clean install succeeds
- typecheck succeeds
- smoke test succeeds
- app boots on supported development target

### Phase 1 - SQLite foundation and data integrity

Purpose: establish the source of truth before OCR is introduced.

Deliverables:
- migration runner
- initial schema
- repository transaction boundary
- Receipt, LineItem, Merchant, Category, NormalizedItem, CorrectionRule, and processing-draft storage
- cascade deletion behavior
- integer-minor-unit currency helpers
- restart-safe database initialization
- repository unit/integration tests

Required schema properties:
- receipt status separates draft/reviewed/accepted states
- raw OCR text is preserved
- normalized names are optional and reversible
- line items belong to exactly one receipt
- deleting a receipt removes dependent user-facing records transactionally
- receipt image is referenced by private file URI/path, not stored as a database blob
- price history is derived from reviewed line items rather than maintained as an uncontrolled duplicate table

Exit gate:
- migrations apply from a fresh database
- repeated startup is idempotent
- insert/read/update/delete transaction tests pass
- cascade tests pass
- currency arithmetic tests pass
- no orphaned line items are possible through repository APIs

### Phase 2 - Capture and image preparation

Purpose: obtain OCR-ready receipt images without creating user friction.

Deliverables:
- camera capture
- gallery import
- receipt-focused framing guidance
- crop and rotation workflow
- orientation normalization
- perspective/deskew extension hook so a proven native geometry corrector can be added without changing the capture contract
- conservative readability preservation through crop, rotation, bounded resizing, and high-quality JPEG preparation; automatic brightness/contrast filters are intentionally excluded until corpus evidence proves they improve rather than damage thermal text
- quality gate for severe blur, darkness, clipping, and incomplete framing
- private image retention policy

Edge cases:
- long receipts
- crumpled receipts
- shadows
- faded thermal paper
- rotated images
- partial framing
- high-resolution memory pressure

Exit gate:
- representative images can be captured/imported offline
- preprocessing preserves legibility
- clearly unusable images trigger an actionable retake message
- acceptable images are not rejected aggressively

### Phase 3 - Offline OCR integration

Purpose: produce spatial text observations, not final receipt records.

OCR output contract:
- recognized text
- bounding box / geometry when supported
- confidence when supported
- page/image dimensions
- stable observation IDs
- raw full-text snapshot

Deliverables:
- `OcrEngine` interface
- native on-device implementation
- deterministic fake engine for tests
- offline execution proof
- normalized OCR observation model
- cancellation/interruption handling

Exit gate:
- OCR works with network disabled
- text and geometry are available to the parser
- OCR failures do not alter saved history
- test fixtures can bypass the native OCR engine

### Phase 4 - Receipt reconstruction parser

Purpose: transform OCR observations into structured receipt candidates.

Parser stages:
1. normalize coordinates and text tokens
2. cluster tokens into lines
3. detect header / merchant region
4. detect date and time candidates
5. detect totals/summary region
6. isolate candidate item region
7. reconstruct multiline item descriptions
8. associate quantities, unit prices, and line totals spatially
9. recognize discounts, VAT/tax, service/other charges, and rounding adjustments
10. preserve alternatives when interpretation is ambiguous

Deliverables:
- parser pipeline with pure/testable stages
- merchant-independent baseline grammar
- merchant-profile extension points
- duplicate OCR-row detection
- return/refund candidate handling
- quantity forms such as `2@85`
- missing-subtotal support
- raw-to-structured traceability

Exit gate:
- supported corpus yields structured merchant/date/total candidates
- supported clean receipts meet declared line-item exactness target
- ambiguity is surfaced rather than invented away
- regression fixtures cover every supported layout class

### Phase 5 - Validation and confidence

Purpose: determine whether extracted values are internally plausible.

Validation rules:
- quantity x unit price vs line total
- sum of item line totals vs subtotal when subtotal exists
- subtotal - discounts + taxes/charges +/- rounding vs final total
- malformed/impossible dates
- unexpected negative/zero values
- likely duplicate rows
- missing/misread item suspicion
- explicit handling of multiple adjustments

Confidence signals:
- OCR confidence
- expected text/data pattern
- spatial alignment
- arithmetic consistency
- merchant-specific confirmed patterns
- agreement between repeated/summary values

States:
- Verified
- Review
- Mismatch

Exit gate:
- deterministic mismatch fixtures are flagged
- validation identifies affected fields
- false mismatch rate is measured on the declared corpus
- validation never claims semantic correctness merely because arithmetic balances

### Phase 6 - Review, correction, and safe save

Purpose: make uncertainty correctable before history is polluted.

Deliverables:
- structured receipt review screen
- direct navigation to flagged fields
- add/edit/remove line item controls
- edit merchant/date/summary amounts
- validation recalculation after edits
- clear Verified / Review / Mismatch states using text/iconography, not color alone
- draft recovery/discard behavior
- accepted-save transaction
- source image/raw evidence view
- sensitive payment-data redaction

Exit gate:
- every tested critical field can be corrected from review
- interrupted review never creates a completed receipt
- accepted receipt reopens identically after app restart
- raw evidence remains unchanged by organizational edits

### Phase 7 - History, search, and item-level value

Purpose: turn reviewed receipts into useful local retrieval.

Deliverables:
- chronological history
- receipt detail
- item search
- merchant search
- category filter
- date-range filter
- normalized item identity
- item price history
- purchase frequency/history
- raw receipt link from derived history
- unlink/reassign normalized items
- conservative merchant-specific correction rules with reset

Exit gate:
- an item from a saved receipt is searchable
- prior reviewed purchases appear in item history
- normalization changes do not overwrite raw descriptions
- deleting a receipt removes its contribution from user-facing history

### Phase 8 - Hardening and corpus-driven QA

Purpose: prove the complete offline workflow, not merely demo screens.

Required test layers:
- unit tests
- parser fixture tests
- validation fixture tests
- repository/database tests
- migration tests
- OCR-to-parser integration tests
- full offline scan/review/save/search tests
- image robustness tests
- merchant-layout tests
- regression corpus
- usability checks
- interruption/restart tests

Baseline quality metrics from the engineering specification:
- critical-field accuracy: >= 95% on declared corpus in the defined user-free extraction phase
- line-item exactness: target >= 90% on supported clean receipts
- deterministic arithmetic mismatch detection: 100%
- false mismatch rate: <= 5% on controlled corpus
- offline completion: 100% on supported test devices
- crash-free defined release-candidate scenarios: 100%
- correction reachability: 100% of tested critical fields from review

Exit gate:
- metrics are computed from a declared corpus
- no critical/high-severity defect remains in the demonstration path
- network-disabled end-to-end acceptance suite passes

### Phase 9 - Release-candidate polish

Purpose: improve usability and reliability without expanding scope.

Deliverables:
- processing progress states
- accessibility pass
- error copy pass
- database backup behavior documentation
- storage cleanup policies
- performance profiling
- memory-pressure checks for long receipts
- release build verification

Exit gate:
- Version 1 Definition of Done is satisfied
- no deferred feature is allowed to displace reconstruction/validation quality work

## Deferred Until Core Quality Is Proven

- PDF/CSV export
- encrypted manual backup/restore
- advanced charts
- multi-receipt batch capture (multiple separate receipts in one batch; this is distinct from the supported 1–5 photos for one long receipt)
- user-defined tagging
- more sophisticated product aliasing
- optional multilingual receipt support

These require separate scope review after the Version 1 acceptance gates are met.

## Implementation Pipeline for Every Feature

Every development slice follows the same engineering loop:

```
Requirement
  -> acceptance condition
  -> data/domain contract
  -> implementation
  -> focused automated tests
  -> integration verification
  -> regression check
  -> commit
  -> push
```

Rules:
1. Do not implement a screen before defining the data/behavior contract it depends on.
2. Do not change parser behavior without a fixture proving the intended case.
3. Do not change schema without a migration and migration test.
4. Do not persist OCR candidates as accepted purchase history before review.
5. Do not use internet connectivity as a hidden dependency in core flows.
6. Do not add scope merely because a library makes it easy.
7. Stop a phase when its exit gate is satisfied; do not polish downstream features prematurely.

## Git Discipline

- Branch: `main` until a multi-developer workflow requires otherwise.
- Each coherent change is committed after validation.
- Every committed change is pushed.
- Commit messages describe the code change only.
- Do not add AI/tool metadata, co-author trailers, generation markers, or unrelated metadata to commits.
- Never commit secrets, local credentials, build artifacts, or machine-specific files.

## Version 1 Completion Gate

Version 1 is complete only when:
- offline capture/import works
- OCR works offline
- structured reconstruction works on the declared supported corpus
- critical fields expose confidence/review states
- arithmetic validation works
- manual correction works
- local save/reopen works
- item-level search works
- price history uses reviewed data
- deletion and restart recovery preserve integrity
- QA corpus and metrics are documented
- no critical/high-severity unresolved defect remains in the demonstration path
