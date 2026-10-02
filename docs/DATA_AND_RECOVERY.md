# Recora Data, Privacy, Cleanup, and Recovery

## Storage Model

Recora is accountless and local-first.

Structured receipt data is stored in SQLite. Retained receipt images are stored as app-private files and referenced by URI from SQLite. Receipt images are not stored as database BLOBs.

Raw OCR evidence is preserved separately from user-organized item names and normalized identities. Manual correction never rewrites the retained OCR text or source image.

## Backup Behavior

Version 1 does not provide cloud sync, automatic cloud backup, or an in-app backup/export workflow.

On Android, application backup is disabled in the Expo application configuration so receipt data is not intentionally copied by Android Auto Backup.

iOS native backup exclusion has not been proven in this repository. If iOS is included in the release/demo target, native iOS backup behavior must be verified before claiming that receipt files never leave the device through operating-system backup services.

Uninstalling the application removes its app-private database and retained receipt files unless a platform-level backup mechanism outside Recora restores application data.

## Startup Cleanup

At startup Recora:

1. clears abandoned temporary staging images from interrupted capture/edit sessions;
2. reads every receipt-image URI referenced by SQLite;
3. removes retained receipt files that are no longer referenced by any receipt row.

This specifically handles the crash window where a prepared image may have been copied into retained storage before the corresponding SQLite draft was committed.

Cleanup failure is non-fatal. The app continues to boot and reports the failure only to development logs rather than deleting database records.

## Deletion

Discarding an unfinished receipt deletes its SQLite receipt row and dependent OCR evidence, then removes its retained image.

Deleting an accepted receipt removes its SQLite row and dependent line items, adjustments, and OCR evidence through foreign-key cascade behavior, then attempts to remove its retained image. History and price-history views are derived from accepted rows, so the deleted receipt stops contributing immediately.

Image deletion is best-effort after the database state is committed. A file-system cleanup failure does not misreport or roll back an already completed database deletion; startup orphan pruning retries any now-unreferenced retained image.

Accepted-receipt deletion requires destructive user confirmation in the UI.

## Interruption Recovery

Receipt states are explicit:

- `draft`
- `processing`
- `review`
- `accepted`

Only `accepted` rows appear in purchase history.

OCR completion is persisted transactionally. A failed or cancelled OCR run does not create accepted history.

The first structurally valid review is persisted as `review`. If the process stops after that point, Recora can rebuild the review from stored review rows and retained OCR evidence instead of reparsing over user corrections.

The home screen exposes the most recent unfinished receipt so work can continue after restart.

## Sensitive OCR Data

Before OCR evidence is persisted, Recora redacts Luhn-valid full payment-card numbers detected in OCR text. The application does not intentionally store full payment-card numbers for purchase tracking.

Receipt content can still contain sensitive transaction information. Production logging should never print raw OCR text, source image contents, or complete receipt records.

## Version 1 Recovery Boundary

Version 1 prioritizes local integrity and restart recovery. Manual export/backup and restore remain deferred scope. They should not be added until reconstruction and validation quality has passed the real-receipt release gate.
