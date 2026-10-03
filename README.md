# Recora

<p align="center">
  <img src="assets/recora-logo.png" alt="Recora logo" width="150" />
</p>

**Recora is an offline-first mobile app that turns printed receipts into structured, validated, searchable purchase records.**

Instead of keeping paper receipts or manually typing every purchase, a user can photograph or import a receipt, review the reconstructed data, correct anything uncertain, and save the accepted receipt into a private local purchase history.

Recora is built around one principle:

> **Capture → Reconstruct → Validate → Track**

## What Recora is for

Recora is designed for people who want a simpler way to remember **what they bought, where they bought it, when they bought it, and how much they paid** without depending on a cloud receipt service.

A printed receipt can contain useful purchase information, but it is difficult to search or compare later. Recora converts that receipt into organized data while keeping the original receipt evidence available for verification.

Typical use:

1. Take 1–5 ordered photos of a printed receipt, or import up to 5 photos from the photo library.
2. Crop and rotate each receipt section if needed.
3. Run OCR directly on the device; long receipts are read one photo at a time and reconstructed as one receipt.
4. Reconstruct the merchant, date, items, quantities, prices, discounts, taxes, charges, subtotal, and total.
5. Check arithmetic and confidence warnings.
6. Correct uncertain fields before saving.
7. Search accepted receipts and items later.
8. View previous purchase and unit-price history for an item.

## Core workflow

```text
Capture
  ↓
Prepare image
  ↓
On-device OCR
  ↓
Receipt reconstruction
  ↓
Validation + confidence
  ↓
User review / correction
  ↓
Local save
  ↓
History + search + item price history
```

OCR is only one stage of the system. Recora's main value is the combination of **structured reconstruction, validation, transparent uncertainty, user review, and searchable purchase history**.

## Main features

### Receipt capture and preparation

- Camera capture with up to 5 ordered photos per receipt
- Multi-photo library import with up to 5 images per receipt
- Sequential page preparation for long sari-sari store and thermal receipts
- Manual four-corner crop
- Left/right rotation
- Orientation-safe image processing
- Long-receipt resizing with a bounded OCR memory budget
- Image quality checks and readability confirmation
- Private retained receipt-image storage

### Offline receipt recognition

- Bundled Google ML Kit Latin text recognition
- Core OCR workflow does not require a remote OCR service
- Raw OCR text is preserved as evidence
- Spatial OCR observations are retained for reconstruction
- Multi-photo receipts are OCRed page-by-page to bound memory, then combined into one ordered virtual receipt document
- All original receipt photos remain available as read-only evidence
- Exact duplicate-looking item rows across receipt photos are flagged for review instead of being deleted automatically
- OCR can be cancelled and retried safely
- Full payment-card numbers detected in OCR output are redacted before persistence

### Receipt reconstruction

Recora reconstructs supported receipt fields including:

- Merchant
- Date and time
- Transaction type
- Item descriptions
- Quantities
- Unit prices
- Line totals
- Discounts
- VAT / tax
- Service and other charges
- Rounding
- Subtotal
- Final total

The parser also handles cases such as multiline item names, quantity forms like `2 @ 40.00`, refunds/returns, missing subtotals, duplicate-looking OCR rows, and ambiguous dates.

### Validation and confidence

Recora does not silently assume that OCR output is correct.

It checks:

- Quantity × unit price against line total
- Sum of line items against subtotal
- Subtotal, discounts, taxes, charges, and rounding against the final total
- Missing critical values
- Suspicious dates
- Unexpected zero/negative values
- Possible duplicate rows
- Parser ambiguity

Receipt fields are surfaced using three review states:

- **Verified** — the current structured values reconcile
- **Review** — a non-blocking uncertainty needs user confirmation
- **Mismatch** — a blocking issue must be corrected before acceptance

### Review before save

Users can review and correct reconstructed receipt data before it becomes purchase history.

The review flow supports:

- Editing merchant and date
- Editing transaction type and totals
- Editing item names, quantities, unit prices, and line totals
- Adding or removing items
- Editing discounts, taxes, charges, and rounding
- Jumping directly to fields that need attention
- Viewing the original receipt image and raw OCR evidence
- Saving a review draft
- Recovering an unfinished receipt after app restart

Only reviewed/accepted receipts enter purchase history.

### Purchase history and search

Accepted receipts can be searched locally by:

- Merchant
- Item name
- Organized/normalized item name
- Category
- Date range

Receipt detail preserves both the reviewed structured data and its original evidence.

### Item and price history

Recora can group equivalent purchased items under a stable local identity while preserving the exact text printed on each receipt.

Item history can show:

- Purchase count
- Latest unit price
- First and latest purchase dates
- Merchant for each purchase
- Historical unit prices
- Link back to the original saved receipt

Merchant-specific item-name corrections can also be remembered conservatively using exact local matches and can be reset by the user.

## Privacy and offline design

Recora is intentionally local-first.

- Core capture, OCR, reconstruction, validation, review, save, search, and history do not require an online account.
- Receipt images are stored in the app's private storage.
- Structured receipt data is stored locally in SQLite.
- Raw receipt evidence is kept separate from normalized organizational values.
- Android application backup is disabled for receipt data.
- Full payment-card numbers are not intentionally persisted from OCR output.
- Accepted receipt deletion removes its dependent history contribution and retained receipt image.
- Recora does not use cloud OCR as a hidden dependency in its core workflow.

## Technology stack

| Area | Technology |
| --- | --- |
| Mobile application | Expo / React Native |
| Language | TypeScript |
| Expo SDK | 57 |
| Local database | SQLite via `expo-sqlite` |
| OCR | Bundled Google ML Kit Latin OCR via `rn-mlkit-ocr` |
| Image input | `expo-image-picker` |
| Image processing | `expo-image-manipulator` |
| Icons | Expo Vector Icons / Ionicons |
| Testing | Vitest |
| Static validation | TypeScript + ESLint |

## Project status

The repository implementation covers **development Phases 0 through 9**, including the complete core Version 1 workflow and post-roadmap performance/UI hardening.

Automated coverage includes:

- Database migrations and transaction integrity
- OCR persistence and cancellation behavior
- Receipt parsing
- Validation and confidence
- Review and recovery
- Search and history
- Normalization
- Offline service-level workflow
- Image geometry and quality gates
- Synthetic parser and validation corpora

The remaining release-quality gates require **physical-device and real-receipt evidence**, including real thermal-receipt OCR measurements, lower-memory-device testing, accessibility/device usability, and native device verification with networking disabled. Synthetic regression results are not presented as universal real-receipt accuracy.

See [Implementation Status](docs/IMPLEMENTATION_STATUS.md) and [QA and Release Evidence](docs/QA_AND_RELEASE.md) for the exact evidence boundary.

## Development setup

### Install dependencies

```bash
npm install
```

### Run project validation

```bash
npm run check
```

This runs TypeScript validation, ESLint, and the complete automated test suite.

Focused QA hardening can also be run with:

```bash
npm run qa
```

### Start Expo

```bash
npm start
```

For native Android development:

```bash
npm run android
```

> **Important:** Recora's OCR uses a native ML Kit module. **Expo Go is not the target runtime for OCR testing.** Use a native/development build when verifying the complete receipt-scanning workflow.

## Project documentation

- [Development Roadmap](docs/DEVELOPMENT_ROADMAP.md)
- [Architecture Baseline](docs/ARCHITECTURE.md)
- [Implementation Status](docs/IMPLEMENTATION_STATUS.md)
- [QA and Release Evidence](docs/QA_AND_RELEASE.md)
- [Data, Privacy, Cleanup, and Recovery](docs/DATA_AND_RECOVERY.md)
- [Refinement and Performance Hardening](docs/PERFORMANCE_HARDENING.md)

The formal project engineering document is also stored in:

`docs/Recora_Project_Documentation.docx`

## Version 1 scope

Recora Version 1 focuses on:

**receipt reconstruction → verification → correction → local storage → retrieval → purchase history**

It is **not** intended to be a banking, payment, POS, accounting, tax-filing, rewards, advertising, social-networking, investment, or cloud-account application.

Features intentionally deferred until the core receipt workflow is proven on real devices include advanced charts, multi-receipt batch capture, user-defined tags, encrypted manual backup/restore, PDF/CSV export, sophisticated product aliasing, and optional multilingual receipt support.

---

**Recora makes a paper receipt useful after the purchase is over — while keeping the user in control of what the system recognized and what gets saved.**
