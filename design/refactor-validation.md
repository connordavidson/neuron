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
hide a regression. The prose gate still reports the chart companion's failures
but requires all six prose-book cases to pass. The separate original audit
continues to fail for unsupported chart content. Licensed extractions and results
remain ignored. Parser versions can change in correctness commits; structural
commits must leave versions and output identical.

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

