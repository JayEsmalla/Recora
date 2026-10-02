# Recora

Offline receipt reconstruction and purchase tracking.

Recora converts photographed printed receipts into structured, validated, searchable local purchase records without requiring an internet connection for its core workflow.

## Core flow

```
Capture -> Preprocess -> OCR -> Reconstruct -> Validate -> Review -> Store & Track
```

## Engineering priorities

1. Correctness and transparent uncertainty
2. Offline operation
3. Data integrity
4. Fast correction workflow
5. Searchable item-level history
6. Privacy by default

See [Development Roadmap](docs/DEVELOPMENT_ROADMAP.md) and [Architecture Baseline](docs/ARCHITECTURE.md).

## Scope

Version 1 focuses on receipt reconstruction, verification, local storage, search, and purchase history. It is not a banking, payment, budgeting, accounting, rewards, or cloud-account product.
