# Recora Refinement and Performance Hardening

## Goal

This pass refines the existing Version 1 feature set. It does not remove receipt reconstruction, validation, review, raw evidence, history, normalization, or offline behavior.

The optimization rule is: remove work from the critical path before weakening correctness checks.

## Startup

- app readiness waits for the database, a lightweight unfinished-receipt summary query, and staging cleanup
- unfinished-receipt summaries avoid loading full raw OCR text during startup
- retained-image orphan scanning is deferred until after the first usable screen
- deferred orphan cleanup is cancelled if the root component unmounts
- database initialization remains singleton-backed and migrations remain authoritative

## Capture and preparation

- the home screen now opens the camera directly; the redundant capture-instructions screen was removed
- photo-library import is available directly from Home
- the quality gate uses one clear readability/completeness confirmation instead of three repetitive confirmations
- full-image preparation bypasses JPEG manipulation when no crop or resize is actually required
- crop dragging applies cumulative gesture deltas against the gesture-start crop instead of compounding them against already-moved corner state
- temporary rotated/prepared files are removed as soon as they are no longer needed
- hard OCR pixel limits and image-quality warnings remain intact
- long receipts can use up to 5 independently prepared photos instead of forcing one extreme-resolution image into memory

## OCR and reconstruction

- multi-photo receipts run native OCR sequentially per photo and merge recognized geometry afterward, avoiding simultaneous decoding/OCR of up to five full-resolution images
- OCR observations are persisted in bounded multi-row SQLite inserts instead of one native bridge call per observation
- the bundled ML Kit Latin-model availability check is cached after its first successful verification instead of repeating native discovery for every scan
- freshly completed OCR evidence is passed directly into review reconstruction instead of being fetched again
- resumed review drafts and review-draft saves reuse receipt-level raw OCR text instead of reloading full spatial OCR observations
- OCR document rebuilding indexes parent/child observations once instead of repeatedly filtering the complete observation list
- duplicate item reconstruction uses a keyed lookup instead of scanning all prior items
- raw OCR evidence remains preserved and unchanged

## Validation and review

- validation is deferred during typing so text entry remains responsive
- save/accept still recomputes current validation synchronously before persistence
- validation duplicate checks and confidence issue lookup use indexed sets/maps rather than repeated full-array scans
- receipt line totals are summed once per validation pass
- review line items are progressively rendered in batches on long receipts; the complete draft is still validated
- tapping an issue for a not-yet-rendered item expands the item batch and then navigates to it
- issue navigation now converts nested field positions into scroll-content coordinates
- review rows and adjustments are persisted in bounded multi-row SQLite inserts
- review-state persistence indexes validation issues once instead of rescanning them per item
- resumed review loading reuses an already-loaded receipt instead of querying it twice

## History and item tracking

- opening History initially loads only the visible Receipts mode
- item search is loaded only when the Items tab is first opened
- categories are not re-queried for every search
- receipt detail does not wait for optional normalized-item suggestions
- history, detail, item-history, and review loading indicators are delayed briefly so fast local queries do not flash unnecessary spinner screens
- history state is cached and invalidated only after changes that make it stale
- accepted receipt item lists and item price histories progressively render large result sets
- merchant learning remains conservative, exact-match, local, and reversible

## UI copy

Removed or shortened text that repeated already-visible state, including:
- capture-guide prose before opening the camera
- intermediate OCR-complete explanation screen
- developer-oriented Home “current build” card
- repeated local/offline explanations on multiple screens
- repeated organization and price-history explanations

Safety-critical explanations remain where they affect a decision:
- raw evidence is read-only
- review/mismatch status is explicit
- merchant learning is exact-match only
- destructive receipt deletion is confirmed
- normalized names do not replace original receipt text

## Integrity constraints preserved

The hardening pass does not change these rules:

- only accepted receipts appear in purchase history
- raw OCR and retained receipt evidence remain separate from user corrections
- arithmetic mismatches remain blocking
- money remains persisted as integer minor units
- SQLite transactions remain authoritative for review/acceptance
- offline OCR remains the primary OCR path
- no synthetic test result is presented as real-camera accuracy

## Remaining performance evidence

Automated tests prove correctness and prevent several scaling regressions, but physical-device profiling is still required for:
- native ML Kit recognition duration on representative Android devices
- camera-to-review latency on long thermal receipts
- memory behavior on lower-memory devices
- keyboard and scrolling behavior on very long editable reviews
- file-system behavior on real device storage
