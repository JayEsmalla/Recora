# Recora QA and Release Evidence

## Purpose

This document separates **implemented automated evidence** from **manual/device evidence that has not yet been proven**. Recora must not claim real-world receipt accuracy from synthetic fixtures.

## Automated QA Layers

The repository currently verifies:

- SQLite migrations, idempotency, foreign keys, and cascade behavior
- receipt draft/review/accepted state transitions
- OCR persistence, cancellation, redaction, and receipt isolation
- parser amount/date/layout behavior
- validation and confidence behavior
- review correction, restart recovery, atomic acceptance, and discard behavior
- accepted-only history/search behavior
- normalized item identity, price history, merchant-specific exact-match learning, unlinking, and rule reset
- image geometry and receipt quality gates
- long-image OCR pixel-budget protection
- complete service-level offline flow from retained image metadata through OCR, review, acceptance, search, reopen, and deletion

The offline end-to-end test replaces global network access with a function that throws. The tested workflow therefore fails immediately if a core service introduces an unexpected fetch dependency.

## Declared Synthetic Parser Corpus

`tests/fixtures/receiptParserCorpus.ts` contains 10 deterministic synthetic receipt layouts covering:

- simple grocery receipt
- quantity plus discount and VAT
- named date plus multiline item
- numeric product descriptor
- service charge
- rounding
- PHP and peso currency prefixes
- grouped monetary amounts
- quantity using `x`
- refund receipt

The corpus deliberately uses controlled OCR line text and geometry. It is regression evidence, not a claim about camera or ML Kit accuracy on physical receipts.

Current enforced synthetic results:

- critical-field accuracy: **100%**
- line-item exactness: **100%**
- deterministic arithmetic mismatch detection: **100%**
- controlled valid-case false-mismatch rate: **0%**

The tests also enforce the roadmap thresholds of at least 95% critical-field accuracy, at least 90% line-item exactness, 100% deterministic mismatch detection, and no more than 5% false mismatches on the controlled validation corpus.

## Real-Receipt Corpus Required Before Final Release Claim

A physical-receipt corpus is still required before Recora can claim the Version 1 accuracy targets in real use. The corpus should be anonymized and should include, at minimum:

- grocery and convenience-store receipts
- pharmacy/personal-care receipts
- restaurant receipts
- VAT and non-VAT layouts
- discounts, service charges, and rounding
- quantity forms
- long thermal receipts
- faded print
- glare/shadow
- crumpled/skewed captures
- at least several merchants/layout families

For every receipt, record ground-truth merchant, date/time when printed, final total, subtotal when printed, item descriptions, quantities, unit prices when printed, line totals, and adjustments.

Metrics must be computed before manual correction. Manual review success should be measured separately.

## Required Device Acceptance Runs

1. Android camera permission granted/denied behavior.
2. Gallery import.
3. Crop and rotation on small and large screens.
4. Native bundled ML Kit OCR with airplane mode enabled before first scan.
5. OCR geometry on real thermal receipts.
6. App kill/restart during OCR and during review.
7. Resume unfinished review after restart.
8. Accept receipt, restart app, search the item, reopen the source receipt.
9. Delete the receipt and confirm it disappears from receipt and item history.
10. Very long receipt on a lower-memory Android device.
11. Screen-reader pass for capture controls, crop actions, review warnings, history, and destructive actions.
12. iOS native build and backup-exclusion verification if iOS is part of the demonstrated target set.

## Severity Gate

A release candidate must not be declared complete with:

- any critical or high-severity defect in capture -> OCR -> review -> save -> search
- accepted history being written before review
- a network dependency in the core workflow
- raw OCR/image evidence being silently overwritten by normalized data
- arithmetic mismatch being silently accepted
- receipt deletion leaving searchable history behind
- a reproducible crash on a supported receipt size

## Regression Commands

Run the full repository gate:

```
npm run check
```

The focused hardening suite is:

```
npm run qa
```

Android JavaScript/Hermes bundling is verified separately with Expo export.

## Tooling Verification

- Expo configuration schema is valid after removal of the obsolete legacy splash field.
- Clean Android prebuild succeeds.
- Final Android Expo/Hermes release-candidate export succeeds.
- Generated `AndroidManifest.xml` sets `android:allowBackup="false"`.
- Generated Android Gradle configuration sets `ocrModels = ["latin"]` and `ocrUseBundled = true`.
- Expo Doctor currently reports 20/21 checks passed. The only remaining warning is React Native Directory metadata marking `rn-mlkit-ocr` as untested on New Architecture. This warning is not suppressed.
- The current REL.AI Windows host has no Java runtime/JAVA_HOME, so native Gradle compilation cannot be used here as proof of New Architecture compatibility. That remains part of the physical/native release gate.
