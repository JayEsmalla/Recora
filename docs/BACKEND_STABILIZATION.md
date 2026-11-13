# Recora Backend Stabilization and Release Evidence

## Scope

Recora is an offline-first, accountless React Native application. There is **no remote API server, distributed queue, or cloud database**. Backend reliability refers to local SQLite transactions and migrations, app-private receipt files, bundled ML Kit OCR, parser/validation rules, accepted history, and crash recovery.

Traditional network load balancing, Redis, server autoscaling, and Kubernetes are not applicable. The equivalent capacity controls are bounded native OCR work, sequential photo processing, SQLite transactions, batch inserts, bounded history paging, and low-memory device testing.

## P0 — Data integrity and recovery (implemented)

- Review persistence uses atomic SQLite transactions. The repository refuses direct acceptance unless the receipt is already in the `review` state, even if higher layers are bypassed.
- OCR rejects a duplicate concurrent job for the same receipt. It also verifies the full ordered set of source image URIs inside the evidence transaction, preventing a scan of older photo pages from replacing evidence for a newer set. Cancellation before or during the transaction rolls back evidence changes.
- A retained receipt image is protected from startup orphan pruning between the filesystem copy and its SQLite reference insert. Startup pruning refreshes the database reference snapshot immediately before synchronous deletion. Failed copies and inserts release protection for retry cleanup.
- Migration 5 adds `review_edit_buffers`. Saving a review persists raw editable form values separately from the validated relational review rows. Incomplete or invalid text can survive Save draft/Save & leave and app restart **without** becoming an accepted record. A subsequent valid review replaces the structured rows and clears the buffer. Acceptance clears the buffer transactionally.
- Migration 5 adds `receipt_maintenance_jobs`, written in the same transaction as final receipt acceptance. Optional merchant learning may run after save without blocking confirmation; unfinished work survives process death and is retried in small bounded batches on app startup. Rule assignment remains exact-match, merchant-scoped, and idempotent.
- Explicit item identity assignment is transactional. Failure to create a merchant rule must not leave a partially linked normalized item or merchant.
- The real Android camera, native SQLite, and ML Kit interruption scenarios still require physical-device validation.

## P1 — Load management and history scale (implemented)

- A FIFO `BoundedWorkQueue` limits simultaneous **native OCR recognition** to one active recognition call with at most two queued calls. Aborted queued work is removed, and excess work is explicitly rejected with a retryable message.
- The service prevents concurrent runs against one receipt across multiple service instances, independent of the native recognition queue.
- Existing protections remain: up to five source photos, sequential multi-photo OCR, image pixel budget, bounded SQLite observation and review child inserts, cached native OCR model availability, deferred review recalculation while typing.
- History uses SQLite LIMIT/OFFSET with filtered total counts, deterministic ordering, and ten results per screen. A 1,500 accepted receipt / 1,500 item synthetic database verifies deep-page completeness, filtered counts, and exclusion of drafts. Synthetic database performance is **not** evidence of device latency.
- Do not introduce a server, background worker infrastructure, cloud OCR, or full-text index without workload evidence and a separately approved product change.

## P2 — Security, privacy, diagnostics, dependencies (implemented with residual findings)

- Cleanup targets are constrained to the Recora-owned private document root or the application's own cache. Unexpected `content://`, external, traversal, encoded traversal, and query-bearing file paths are rejected before deletion.
- Local diagnostics categorize failures without retaining exception messages, OCR text, receipt IDs, file paths, or stack traces. A 50-event bounded in-memory record drives local counters; no automatic network telemetry is introduced.
- Android backup remains disabled in Expo configuration. iOS backup-exclusion behavior is not yet native-verified.
- `node-forge` dependency has a compatible override to a patched version, verified against the lockfile; this avoids force-downgrading Expo.
- **Residual advisory risk:** the production-tree `npm audit --omit=dev --audit-level=high` reports **12 total advisories, including two high-severity** after the compatible patch. High-severity findings remain in Expo's transitive `zod` / `deepmerge` dependency chain. `zod` 4.x is not presumed compatible with Expo tools depending on 3.x; `deepmerge` currently has no newer stable version from the registry check. Do **not** force a breaking override or claim zero vulnerabilities. Reassess when compatible upstream fixes ship, and review build-time versus packaged-runtime exposure.
- No remote account, POS infrastructure, or cloud sync is added.

## P3 — Verification and release gates

### Automated and build checks

1. `npm run check`: TypeScript, lint and complete Vitest suite.
2. `npm run qa`: focused network-forbidden offline service flow, parser corpus, validation corpus, quality/geometry/cleanup.
3. `npx expo export --platform android`: Android JavaScript/Hermes export.
4. `git diff --check`: change hygiene.
5. Review `npm audit --omit=dev --audit-level=high` and explicitly retain unresolved upstream advisory decisions.
6. Native Android compile if SDK/JDK and compatible ML Kit tooling are available; no JavaScript-only step proves native readiness.

### Physical-device evidence required before final release

- Fresh install and first recognition with airplane mode enabled; confirm bundled Latin model works on real Android.
- Camera permission denied and granted, gallery import, photo preparation, 1/3/5 ordered photos, long thermal receipts and low-memory device.
- Kill/restart during file retention, OCR, edit-buffer saving, acceptance, merchant maintenance, and deletion.
- Validate preservation of invalid/incomplete edit buffer, no accepted history before review, no duplicate acceptance, and correct retained image references.
- 100+ anonymized real receipts with independently labeled ground truth and separate OCR, parser, validation and manual-review metrics. Current synthetic accuracy does not establish real-world accuracy.
- SQLite stress with realistic on-device history volume and memory/storage pressure; measure P50/P95 timings and peak native memory.
- Screen reader, Android Back, reduced motion, large text, and narrow-screen behavior.
- iOS native build, image capture/OCR compatibility, and backup behavior if iOS is included in release.

Do not claim real-device success, zero security advisories, or a final store-ready release until these open gates are demonstrated.

## Versioned migration verification

Migration 5 is additive: existing receipts and pages remain untouched. On upgrade, confirm rows and foreign keys remain intact, migration bookkeeping is idempotent, optional maintenance jobs are created only for newly accepted receipts, and deleting a receipt cascades its buffered edits and maintenance job. Rollback must not accept an invalid receipt or overwrite existing raw OCR evidence.

## Release decision

P0–P2 software-hardening gates are accepted only after passing the full automated check and code review. P3 is not complete until external device, corpus and unresolved advisory decisions are addressed. Each coherent validated phase should be committed with a standard Git message; no AI attribution/co-author trailers or generated logs/build output are required.
