# Recora

Offline-first receipt reconstruction and purchase tracking.

Recora converts photographed printed receipts into structured, validated, searchable local purchase records without requiring internet access for its core workflow.

## Core flow

```
Capture -> Preprocess -> OCR -> Reconstruct -> Validate -> Review -> Store & Track
```

Version 1 includes local camera/gallery capture, image preparation, bundled on-device OCR, receipt parsing, arithmetic validation, manual correction, restart-safe drafts, SQLite persistence, accepted-receipt history, item/merchant search, normalized item identities, categories, and reviewed price history.

## Engineering priorities

1. Correctness and transparent uncertainty
2. Offline operation
3. Data integrity
4. Fast correction workflow
5. Searchable item-level history
6. Privacy by default

## Development

```
npm install
npm run typecheck
npm run lint
npm test
npm run check
npm run qa
```

The native OCR module requires a development/native build; Expo Go is not the runtime target for OCR verification.

## Documentation

- [Development Roadmap](docs/DEVELOPMENT_ROADMAP.md)
- [Architecture Baseline](docs/ARCHITECTURE.md)
- [Implementation Status](docs/IMPLEMENTATION_STATUS.md)
- [QA and Release Evidence](docs/QA_AND_RELEASE.md)
- [Data, Privacy, Cleanup, and Recovery](docs/DATA_AND_RECOVERY.md)

## Scope

Version 1 focuses on receipt reconstruction, verification, local storage, search, and purchase history. It is not a banking, payment, budgeting, accounting, rewards, tax-filing, advertising, social, or cloud-account product.

Synthetic regression metrics are not presented as real-receipt accuracy. Physical-device OCR and real-receipt corpus evidence remain required before a final release-quality claim.
