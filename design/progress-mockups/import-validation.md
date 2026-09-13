# Local PDF import validation - September 13, 2026

The broader import check fails chapter accuracy on all four requested PDFs, in both structured and text-only parsing. These are additional failures beyond the Behave fix. The progress calculation remains numerically valid, but missing or incorrect navigation makes the chapter markers misleading.

Tested on `codex/reading-progress-mockups`, with content parser version 9 and chapter metadata version 4. This round adds an audit and repeatable checks; it does not fix these newly identified parser defects.

| Local PDF | Pages | Structured fresh import | Text-only fresh import |
| --- | ---: | --- | --- |
| DalioChangingWorldOrderCharts.pdf | 112 | 0 of 14 numbered chapter sections recognized | 0 of 14 recognized |
| How-Countries-Go-Broke.pdf | 400 | 0 of 19 numbered chapters; 4 false Part destinations on contents pages | 0 of 19 chapters; 3 false Part destinations on contents pages |
| Principles For Navigating Big Debt Crises By Ray Dalio.pdf | 471 | All 3 checked detailed case-study chapters missing | Same 3 missing, plus 49 false Part entries from running footers |
| The 7 habits of highly effective people restoring the character ethic by Stephen R. Covey.pdf | 219 | Only habits 1, 2, and 7 recognized as chapters | Only habits 1, 2, and 7 recognized as chapters |

**How Countries Go Broke:** The reading start incorrectly lands on PDF page 8, a contents page, instead of the introduction on PDF page 11. Its first chapter begins on PDF page 23. All 19 chapter destinations were checked against the numbered headings; the PDF page numbers are stored in the expected-data fixture. The extracted heading spells out `C H A P T E R`, which the fresh-import parser does not normalize. The contents pages also lack an explicit "Contents" heading, so their Part titles are incorrectly treated as destinations.

**7 Habits:** The correct habit starts are PDF pages 36, 54, 92, 129, 151, 171, and 188. Habit 3 appears only as an ordinary section, and habits 4-6 do not become chapter markers. Their headings place a label such as `Habit 4:` on its own line; the chapter recognizer currently requires text after the colon. A section entry on the same PDF page is not counted as a correct chapter. The current rail has five markers: three habit starts plus its two endpoints.

**Big Debt Crises:** The three detailed case studies begin on PDF pages 70, 112, and 168, corresponding to printed pages 5, 47, and 103 in Part 2. None appears as an individual chapter in fresh imports. Text-only extraction additionally admits 48 repeated Part 3 footer entries and one Part 2 footer entry. The reading start lands on copyright text on PDF page 2 rather than the introduction on PDF page 7. Contents leaders extract as replacement glyphs and are discarded during text cleanup; the contents recognizer then loses evidence for the unnumbered case-study headings. Part 3's 48 individual cases also lack fresh-import navigation; the automated chapter-coverage denominator above specifically covers the three Part 2 case studies, not every subsection in this book.

**Changing World Order:** This local file is the charts-and-tables companion, not the full prose book. Its numbered sections run from chapter 1 on PDF page 2 through chapter 14 on PDF page 86, with a chapter 2 addendum on PDF page 13. Fresh imports miss all 14 main chapter sections and produce only 23 reading units with geometry, or 22 without it. This chart-heavy file is poorly represented by the current prose-only reader; absence of invented chapter markers does not constitute a successful import.

The separate navigation-refresh function recognizes all 19 Countries chapters, all 7 habits, and all 3 detailed Debt Crises case studies in this diagnostic comparison. That is not a workaround for new imports: fresh imports are saved with the current chapter version, so opening them does not trigger a refresh. The two parsing paths need consistent chapter evidence and destination checks. The charts companion also exposes poor paragraph anchoring in refresh results; recovering a title alone is not enough to guarantee a useful jump.

Validation used the existing local PDFs copied into the app's storage, their original filenames, and new macOS PDFKit extractions. Each PDF was parsed with geometry and again with geometry removed, retaining its text and PDF outlines. Reference contents and chapter pages were rendered and visually inspected. File checksums pin the expected page numbers to these specific editions.

All eight runs produced readable content and passed the checks for navigation bounds, at most two sentences per unit, finite monotonic progress, ordered marker fractions, and in-memory reading-session restoration at three positions. These checks do not establish complete text retention or native persistence. The existing 61 automated tests and TypeScript check pass, demonstrating that those tests did not cover these real-file failures.

The native Files-picker import, on-device sentence tokenizer, and simulator reopen flow remain unverified in this round because the Mac is locked. macOS PDFKit diagnostics are not a substitute for iOS execution.

Reproduce with `node tools/validate_local_imports.cjs tmp/import-validation/manifest.json tmp/import-validation/results.json`. It exits with status 1 when the chapter, forbidden-navigation, reading-start, or invariant checks fail. The expected titles/page numbers and PDF checksums are in `tests/fixtures/local-imports.expected.json`. The local manifest supplies each PDF's path and original filename; extraction JSON sits beside the manifest at `<slug>/extraction.json`, generated with `tools/extract_pdfkit.swift`. The PDFs, extracted text, rendered reference pages, and detailed results remain under ignored local paths. No library entries or bookmarks were changed by this audit.
