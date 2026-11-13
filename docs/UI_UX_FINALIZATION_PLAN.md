# Recora UI/UX Finalization Plan

## Product promise and audience

Recora is a **private, offline-first receipt organizer**, not a point-of-sale or inventory application. Its essential journey is **take or choose receipt photos → frame each photo → read text on-device → check and correct the result → save → find receipts/items/prices later**.

Design for shoppers, small-store operators, and people who rarely use applications. Do not assume familiarity with OCR, transaction reconciliation, accounting, or search filters. Preserve Recora's restrained green/cream visual identity, clear typography, and calm card layout.

**Success criterion:** Someone using Recora for the first time should understand what to tap, what the app is doing, whether their receipt is saved, and how to fix a problem—without a tutorial.

## Principles

1. **One main decision per screen.** A strong primary action, one secondary escape route, and optional advanced tools hidden until needed.
2. **Use familiar language.** Prefer "Take receipt photo", "Check details", "Save receipt", "Find saved receipts"; show technical OCR/evidence only when the person wants it.
3. **Respect the original receipt.** Never silently correct uncertain amounts, remove duplicate-looking rows, or change accepted data without review.
4. **Show progress and control.** Multi-photo progress should say photo N of at most 5; reading should name its current step; users can cancel safely.
5. **Recovery over blame.** Explain what failed, what was preserved, and the next action; keep unfinished drafts recoverable.
6. **Mobile-first and accessible.** Target interactive surfaces at least 44 × 44 logical points, meaningful accessibility labels, scalable text, readable contrast, and graceful keyboard/small-screen layouts.
7. **Motion should clarify, not delay.** No gratuitous page-loading animations or perpetual shimmer. Respect reduced-motion settings and avoid animation during heavy OCR/SQLite work.
8. **No dark patterns.** Explicit confirmation for destructive operations, no fake completion, and no hidden cloud/account requirement.

## Screen-by-screen finalization backlog

| Area | Usability objective | Priority |
| --- | --- | --- |
| Home | Plain-language promise; prominent camera action; smaller import action; clear resume-draft action before low-priority navigation; clear offline/privacy signal | P0 |
| Capture | Explain one photo vs. long receipt; framing tips where needed; cancel/camera-permission error recovery; strong button labels | P0 |
| Photo editor | Explain drag handles; make rotate/reset understandable; guide incomplete or blurry crops without technical jargon; no cropped-out totals | P0 |
| Multi-photo staging | Show N of 5; make adding photos optional; keep a clear "Read receipt" next action; make "Finish later" explicit | P0 |
| Reading | Informative progress for multi-photo OCR; safe cancel/retry; no misleading percent or spinner-only UI | P0 |
| Review | Plain-language checks; affected-field navigation; verified/review/mismatch meaning explained; visible totals; sticky save actions; confirm irreversible discard | P0 |
| Save confirmation | Confirm success and offer direct entry to saved history, plus an easy return home | P0 |
| History | Two simple modes (Receipts/Items), usable search, filter visibility, honest no-result states, paged results with counts and Previous/Next | P0 |
| Receipt detail | Easy-to-scan merchant/date/total, expandable item history and advanced evidence, confirmed deletion | P1 |
| Item price history | Meaningful price labels and dates; load-more controls for long histories; distinguish unit from line total | P1 |
| Help and trust | Short first-use tips and optional "How it works"; privacy/offline explanation near relevant moments, not repeated everywhere | P1 |
| Navigation | Android back behavior, return to previous search and scroll position, draft exit/resume paths, no unintentional data loss | P1 |
| Accessibility | Screen-reader flow, focus/reading order, keyboard behavior, font scaling, touch targets, color contrast, voice descriptions | P1 |
| Motion | Consistent interaction feedback, short useful transitions, reduced-motion alternatives, success/error feedback | P2 |
| Scale and responsiveness | Small Android phones, large text, narrow widths, long merchant/item names, lots of receipts, long thermal receipts | P2 |

## Navigation, filtering and pagination

- Keep **Home → Scan → Frame → Read → Review → Save** linear and obvious. Every step must have a safe Back/Cancel route.
- History uses ten entries per page as an initial mobile-friendly cap. Page controls must show the true total and visible range, disable invalid directions, and reset to page 1 when the results or selected mode change. Do not show pagination when the result fits on one page.
- History paging is now **database-backed**: local SQLite uses a bounded page size, stable ordering, LIMIT/OFFSET, and independent filtered totals. Receipts and items are queried separately, with result-count and boundary tests. Cursor-based paging can be considered if extreme library sizes ever justify it.
- Date filtering now has Any date/This month shortcuts and strict calendar/range validation. Typed custom dates remain supported; a platform-native picker may be considered after real-device usability sessions. Filter state, selected tab, page, and scroll position are restored after opening details.
- Make empty states task-specific: "No receipts yet" offers an obvious next scan, while "No matches" offers a clear-filter route.
- Never combine horizontal swipe navigation with screen areas where a swipe is meant for crop handles, vertical scrolling, or form input. Use labeled controls first.

## Motion and transition specification

| Event | Recommended behavior |
| --- | --- |
| Tap primary/secondary actions | Immediate pressed state (opacity or subtle scale); do not defer action |
| Enter/leave a major screen | Optional 120–180 ms subtle opacity or horizontal movement, never full-screen loading flashes |
| Expand advanced filters/evidence | Gentle 150–200 ms size/opacity only if it does not interfere with content measurement and native accessibility |
| OCR or database wait | Show an indicator only when the operation takes long enough to notice; use human-readable stage labels rather than invented percentages |
| Save success | Clear static check mark plus text; an optional single 180 ms entrance, never mandatory animation |
| Error/warning | Stable descriptive text and the action to take; no shaking screens or aggressive motion |
| Pagination | Immediately move focus/scroll toward updated results; avoid long smooth scrolls |
| Reduced motion | Bypass nonessential animated movement and preserve the same functional feedback |

Limit concurrent animations, especially when processing large images. Avoid external animation libraries unless a device-tested interaction needs one. Use native-driven transforms/opacity where appropriate.

## Responsive and accessibility acceptance criteria

- Verify at ~320–360 dp compact width, 390–430 dp common width, and larger displays; portrait plus orientation handling where the app allows it.
- Test with Android font-size increases, screen reader on, keyboard visible, keyboard dismissal, and navigation gestures.
- Controls should remain reachable at 44 dp minimum where practical; avoid clipping values or hiding required labels behind the keyboard or fixed action bar.
- Important states must use **words + icons**, not color alone; color contrast should be checked against WCAG AA targets for normal/large text and components.
- Avoid tiny low-contrast secondary text; labels should not depend on placeholders only.
- Support long names and amounts, empty lists, slow OCR, refused permission, malformed receipt fields, and local database errors.

## Quality assurance and release gates

1. **First-time user walkthrough:** Camera → one photo → frame → read → resolve at least one warning → save → view history. No help from a developer.
2. **Long receipt:** Three to five photos, out-of-order prevention/guidance, no missing pages, retained evidence, realistic OCR wait.
3. **Error recovery:** Cancel and retry OCR, resume after app restart, preserve draft after a failed action, confirm discard/deletion.
4. **History growth:** 0, 1, 10, 11, 23, and hundreds of receipts; verify next/previous bounds, tab and filter resets, date/search results, back-navigation continuity, text wrapping.
5. **Accessibility:** TalkBack labels/focus, large fonts, touch targets, switch/keyboard navigation where applicable, reduced motion.
6. **Performance:** Cold startup, time to first actionable home screen, first receipt preview, long review typing, history filtering, memory during 5-photo OCR.
7. **Native offline evidence:** Run flows on real low/midrange Android hardware with internet disabled and representative thermal receipts. JavaScript/unit tests alone cannot prove camera/OCR ergonomics.
8. **Regression:** Typecheck, lint, unit suite, offline end-to-end, and physical-device release checklist must pass before release claim.

## Iteration order and decision gates

**Pass A — clarity and safety (implemented, automated gate passed):** Simplified core copy and primary actions, added paged history, confirmed discard, and save-on-exit for review edits; preserved offline/review integrity.

**Pass B — journey cohesion (implemented, automated gate passed):** Preserve history filters/mode/page/scroll, validate dates, add date shortcuts, honor Android Back behavior, and return from item history to its entry point. Review safely saves a draft before leaving.

**Pass C — visual and interaction polish (code implemented, automated gate passed):** Narrow-screen form stacks, larger supporting text, larger touch targets, pressed-state feedback, and a subtle native-driven history-content fade that respects reduced motion. Physical screen-size review remains pending.

**Pass D — release evidence:** Usability sessions with at least five first-time users of different app familiarity, accessibility checks, real-device performance and offline QA. Record task completion, points of confusion, support needed, and fixes.

## Implementation verification record

The P0–P2 repository implementation has passed `npm run check` (TypeScript, ESLint, and the automated test suite). History query tests cover filtered totals, page boundaries, and independent receipt/item pagination. Android JavaScript export with `npx expo export --platform android` also completed successfully.

The native host has Java available but no ADB command, so there is **no claim** that camera OCR, real-device gestures, small-screen overflow, TalkBack, or physical-device performance have been verified. These remain release gates, not automatically passing tests.

### Release acceptance checklist (device required)

- [ ] Perform capture → crop → read → correct → save → find with real printed and thermal receipts
- [ ] Verify 1, 3, and 5 photo receipts, offline recognition, cancellation and retry
- [ ] Check Android system Back and gesture navigation, especially edited review draft recovery
- [ ] Validate 320–360dp, 390–430dp and large fonts, keyboard overflows, and portrait behavior
- [ ] Use TalkBack and reduced-motion settings with real focus/navigation verification
- [ ] Validate history pagination/filter restoration on a device with over 100 saved receipts and items
- [ ] Complete usability sessions with at least five first-time users and log refinements

Do not call Recora fully finalized until these device and receipt-quality gates are satisfied. No new account, POS, inventory, cloud sync, or AI feature is required to accomplish this UI/UX phase.
