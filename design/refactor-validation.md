# Reader refactor acceptance and rollback

All acceptance tests and procedures were authored before production changes on
`codex/refactor-reader-foundations`, starting at `9e11058`.

## Automated coverage

Run `npm test` and `npm run typecheck`. The existing suites plus lifecycle,
parserAcceptance, storageAcceptance, readerAcceptance and nativeAcceptance cover
the plan's behavior matrix. The custom React harness runs production callbacks
and hook lifecycles; it does not simulate native layout or touch delivery. Swift
scanner tests execute the production scanner with framework doubles, so they
prove promise/delegate lifecycle and recovery, not camera quality or device latency.

Run the Python fixture suite using an isolated environment with
`requirements-corpus.txt`. Parser structural refactors must match all private
baseline output recorded by:

```
node tools/compare_parser.cjs tmp/import-validation tmp/refactor-baseline --record
node tools/compare_parser.cjs tmp/import-validation tmp/refactor-baseline
node tools/check_prose_imports.cjs tmp/import-validation/manifest.json tmp/refactor-baseline/import-results.json
node tools/benchmark_page_scan.cjs
```

Only run `--record` on the reviewed baseline; never regenerate golden fixtures to
hide a regression. The prose gate requires the six prose-book cases to pass; the
chart companion remains outside the supported prose audit and is documented as a
known limitation. Licensed extractions and results remain ignored. Parser versions
can change in correctness commits; structural commits must leave versions and
output identical.

## Device acceptance procedure (written before refactoring)

Use a disposable simulator/library, never reparse the user's saved library for
these checks. Record device/build and pass/fail/unavailable for each case.

1. Import a synthetic PDF through Files; confirm title, cards, chapters and first
   reading position. Open a PDF from a file URL too; duplicate delivery must not
   create a second import.
2. Swipe deep into the book in both directions; jump to chapters; close, reopen,
   background, terminate and restart. Verify exact visible text and progress.
3. Resize/rotate and switch font size from 18 through 32. Very long sentence
   pairs scroll internally. Tapping text toggles chrome without changing place.
4. Open chapters, notes and settings in succession. Only one panel is visible.
   Check all themes, screen-reader labels, focus, selected chapter and progress.
5. Start reparse, then move, close, switch books, reopen or delete the original
   book while work is pending. No stale jump, reopening, restored deletion or
   chapter overlay is allowed. Simulated disk failures retain the old layout.
6. Rebuild after Swift changes. On a physical device scan one real page from the
   open ebook, check the first reliable phrase, saved position, and Undo after
   subsequent navigation. Retry with OCR noise, wrong book and repeated text.
7. Test cancellation, denied permission and Settings recovery, multiple captured
   pages, duplicate taps, backgrounding, reader close and layout replacement
   while capture/OCR/matching is pending. No stale result may commit.
8. Confirm the native extractor and tokenizer still import a PDF after scanner
   separation. Record physical scan time independently of desktop benchmark.

## Commit gates

The initial test commit records a known failing acceptance set for existing bugs.
Structural commits must add no failures. Correctness commits remove the relevant
failures. All tests must be green before completion. Keep each refactor commit;
revert dependent commits in reverse order. Code rollback does not undo an explicit
reparse already persisted to a library. Held-out corpus promotion remains blocked
until independently annotated data exists.

## Initial baseline

132 JavaScript/Swift-harness tests: 112 passed, 20 failed for existing defects.
TypeScript passed. All 8 Python corpus tests passed in the isolated environment.
The 300,000-word scan benchmark matched card 4580 in 105 ms (desktop only).
All eight private parser outputs were recorded before production changes.

Known failing tests (no skips or expected-failure annotations):

- lifecycle: reparse completion respects move

- lifecycle: reparse completion respects close

- lifecycle: reparse completion respects switch

- lifecycle: reparse completion respects reopen

- lifecycle: reparse completion respects delete

- lifecycle: content save completion respects move

- lifecycle: content save completion respects close

- lifecycle: content save completion respects switch

- lifecycle: content save completion respects delete

- lifecycle: duplicate reparse requests launch one extraction

- lifecycle: duplicate imports launch one extraction

- lifecycle: late navigation refresh cannot overwrite a full reparse

- lifecycle: callbacks from a replaced reader cannot change its new layout

- chapter correction: structured C H A P T E R 4

- chapter correction: structured Habit 4:

- chapter correction: text-only C H A P T E R 4

- chapter correction: text-only Habit 4:

- chapter correction: structured unlabeled contents and malformed leaders

- chapter correction: text-only unlabeled contents and malformed leaders

- storage: chapter overlay belongs to layout old

## Final validation

The acceptance suite was rerun after every production checkpoint. The final run
is 132/132 JavaScript and Swift-harness tests, with no skips or expected-failure
annotations; TypeScript typechecking passes. The isolated Python corpus suite is
8/8. The prose import audit passes both extraction modes for Countries (19/19
chapters), Debt Crises (3/3 case studies), and the Seven Habits (7/7), with the
expected reading starts and no forbidden navigation. The four chart-heavy checks
also pass their limited chapter assertions, while full chart-layout support stays
out of scope.

The final desktop scan benchmark matched paragraph 4580 with 245 words in 174 ms
and a 20 ms maximum event-loop gap on the 300,000-word fixture. This is a desktop
performance baseline, not a physical-camera measurement.

The native Release simulator build succeeded after the Swift scanner split. In a
disposable iOS 26.2 simulator, the synthetic PDF imported through the real Files
picker, opened at its first card, exposed all three chapters, jumped to Chapter 3,
swiped, changed theme and text size, preserved 67% progress on close, and restored
that position on reopen. The scanner screen, camera denial recovery, and on-device
processing copy were also checked. Physical-camera capture, OCR quality, device
latency, and the physical Undo flow remain unavailable in this environment and
must be completed on a device using the procedure above.

The implementation is preserved as these independent commits, in order:

```
16420f0 test: define reader refactor acceptance suite
62dc21b refactor: centralize book content and storage preparation
177e030 refactor: extract book lifecycle controller
e944aa3 fix: prevent stale operations from replacing reader state
65a1ff1 refactor: split semantic parsing into focused stages
93870e6 refactor: share source chapter evidence
dcb02f1 fix: align chapter detection for documented prose books
d352be1 refactor: separate reader navigation and panels
cb96e2a refactor: isolate native page scanning
2bb67bf test: run legacy sentence assertions through production parser
6575f48 fix: preserve prose and ellipses across opening PDF pages
8e11ae4 refactor: retire unused import implementations
```
