# Recora Architecture Baseline

## Decision Summary

Recora is a local-first React Native mobile application. Structured data is stored in SQLite. Receipt images remain in app-private filesystem storage and are referenced from SQLite. Core processing does not require a backend service or cloud account.

## Layers

### Presentation

Responsible for:
- rendering state
- collecting user input
- navigation
- accessibility
- progress and error feedback

Must not:
- parse OCR text
- execute receipt arithmetic rules
- execute raw SQL
- infer confidence states

### Application

Coordinates use cases:
- capture/import receipt
- process receipt
- review/correct receipt
- save accepted receipt
- delete receipt
- search history
- retrieve item history

Application services own orchestration and transactions, not UI components.

### Domain/Processing

Pure or mostly pure modules:
- image/OCR observation models
- receipt candidate models
- parser stages
- validation rules
- confidence rules
- currency helpers
- normalization rules

These modules should remain testable without a device.

### Infrastructure

Adapters:
- SQLite database
- private filesystem
- native OCR engine
- camera/gallery
- platform-specific image processing

Infrastructure satisfies interfaces defined by higher layers.

## Persistence Rules

- SQLite foreign keys are enabled.
- Money is persisted as integer minor units.
- Receipt deletion cascades through dependent line items.
- Accepted records are never created implicitly from interrupted processing.
- Raw OCR evidence and source image references are preserved when configured.
- Derived item history reads from reviewed/accepted source data.
- Merchant learning rules are local, reversible, and scoped.

## Processing State Model

A receipt moves through explicit states:

```
draft
  -> processing
  -> review
  -> accepted

draft/processing/review
  -> discarded
```

A processing failure never transitions directly to `accepted`.

## Boundary Rule

The OCR engine returns observations. It does not return a trusted receipt.

The parser returns candidates. It does not certify correctness.

The validation and confidence engines evaluate candidates. They do not silently repair ambiguous values.

The review workflow is the final human verification boundary before accepted purchase history.
