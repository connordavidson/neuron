# neuron

neuron is a new type of reader. The current app, FlowReader, is a React Native iOS reader that imports text-based ebook PDFs and turns them into a focused, vertical, two-sentence feed.

## What it does

- Imports PDFs from Files, iCloud Drive, and other iOS document providers
- Extracts text locally with Apple's PDFKit (books never leave the device)
- Reconstructs columns, lines, paragraphs, reading order, and page-spanning prose from PDF geometry
- Detects and removes running headers, footers, and page numbers by position, style, and document-wide repetition
- Snaps each vertical swipe to the next reading page, pairing two sentences when they total at most 32 words
- Fuses PDF outlines, spatial contents entries, numbering, typography, whitespace, alignment, and document position for navigation
- Detects title-page metadata plus front matter, chapters, parts, appendices, notes, references, indexes, and other semantic sections
- Starts at the introduction/body on first open, while retaining copyright, dedication, and contents for backward scrolling and the section picker
- Provides a chapter picker for quick navigation
- Scans a physical book page on-device and jumps to the matching ebook passage, with Undo
- Saves the visible reading page automatically, including when the app is backgrounded
- Opens cached book content without reparsing or replacing it during a reading session
- Measures reading progress by body-text word counts and retains PDF page numbers on new imports
- Shows a slim right-side progress bar that fills from top to bottom, with chapter dots spaced by cumulative body-word counts; longer chapters occupy more of the bar
- Includes paper, sepia, and night themes plus adjustable text sizing
- Stores and searches a local book library
- Sorts books by most recently read
- Swipe left on a book to reveal Delete; removal still requires confirmation
- Keeps closing quotation marks attached to their sentences, including repairs for older imports without shifting bookmarks
- Keeps body footnotes, captions, tables, and references contextual; dedicated notes, bibliography, index, and credits sections remain readable
- Anchors bookmarks to the PDF page, source offset, and a normalized context hash

## Run on iOS

Use Xcode 26.2 (the tested version) and Node 20.19.4 or newer.

```sh
nvm use
npm install
npm run ios
```

The first iOS run generates the native project and links the local PDFKit module. Because FlowReader includes custom native code, use the generated development build rather than Expo Go. After that, `npm start` starts the development server for fast refresh.

After native extractor changes, rerun `npm run ios`: refreshing JavaScript alone does not update PDFKit extraction. An older development build can fall back to text-only extraction, which loses the geometry needed for reliable chapter detection.

For a physical iPhone, connect and trust it, enable Developer Mode, then run `npm run ios -- --device`. Choose your device and configure your Apple development team/signing in Xcode if prompted. The phone and computer should be on the same network while using the development server. Change the bundle identifier and Apple team in `app.json` for your own distribution.

## Scan a physical book page

Open the matching ebook, tap **Scan page** at the bottom of the reader, then **Open camera**. Scan one page in good light, include the top of the text, crop if needed, and tap **Save**. A strong text match moves you to the reading card containing the first reliable matching phrase. **Undo** restores and saves your previous place; the result remains available until dismissed, another scan starts, or the reader closes.

The scanner uses Apple's page camera and Vision text recognition locally. Images stay in memory and are not saved or uploaded by FlowReader. Text matching searches only the open ebook and does not rely on printed page numbers. It tolerates modest OCR errors and different pagination, but translations or editions with substantially different wording may not match. V1 is validated with English prose in existing text-based PDF imports. It does not import a new ebook, search the whole library, or read a barcode.

Short, unclear, and repeated text does not change your bookmark. Capture more surrounding body text or a clearer image and retry. If camera access is denied, use **Open Settings** to enable it. Cancellation preserves your position; a scan finishing in the background briefly keeps the scan button disabled to prevent overlapping camera requests.

This feature adds native code and a camera permission description. Rebuild the development app after updating; JavaScript refresh alone is insufficient. When upgrading an already generated native project, run `npx expo prebuild --platform ios --no-install` to sync `app.json`, then `npm run ios` (or `npm run ios -- --device` for a phone). No book storage migration or reimport is needed.

Run `node tools/benchmark_page_scan.cjs` for a deterministic desktop baseline with 300,000 synthetic book words, a 260-word scan, and simulated OCR substitutions. This measures matching only, not camera/OCR latency or physical iPhone performance. See [scan validation](design/page-scan-validation.md) for verified behavior and remaining device checks.

## PDF support

The importer requires a PDF with a selectable text layer. Image-only scans need OCR before import. PDF text often contains visual line breaks instead of semantic paragraphs. FlowReader joins continuous text within each chapter, uses Apple's on-device Natural Language sentence tokenizer, and filters its boundaries for PDF ellipses, closing quotes, dialogue attribution, and initials. Ellipses such as `...`, `. . .`, and `…` are treated as a unit, never as individual sentences. Adjacent sentences are considered in pairs: pairs totaling at most 32 whitespace-separated words stay together, while longer pairs become two one-sentence pages. Later pairs keep their original grouping, and a final leftover sentence stands alone. Individual sentences are never split. Ambiguous punctuation can still require interpretation.

Parser changes apply automatically to new imports. Existing books retain their card layout and bookmark. Outdated chapter navigation refreshes separately after opening a book, without rebuilding its reading pages. To use the latest parser for an existing PDF, import it again as a new library entry; its previous reading position is not transferred.

Copyright and other front matter can be reached from the section picker or by scrolling backward from the reading start. Dedicated notes and credits remain available at the back. Optional copyright, notes, bibliography, and index text does not add to the main reading-progress denominator.

All reading pages use the selected font size. The 32-word pair limit targets roughly six lines, but actual line count depends on word lengths, font size, and screen width. Individual sentences have no hard word cap; exceptionally long sentences and older saved pairs can still scroll within their page. The progress bar stays in the right margin and hides with the reader controls. Completed chapter dots are filled and upcoming dots are outlined; tightly packed boundaries become small ticks at their true positions. Books without detected chapters show a continuous bar. A chapter's final unpaired sentence also stands alone so the next chapter starts on a fresh card.

Uncertain navigation candidates are suppressed rather than presented as chapters. Bookmarked chapter titles are checked against their destination text even when font geometry is unavailable, including numbered titles split across lines. With a confirmed chapter outline, unlisted internal Part headings between chapters stay within their containing chapter. Every accepted metadata and structure value stores confidence and evidence, and every block and reading unit links back to its original PDF page and source range. PDF structure varies, so missing or unreliable text may still produce incomplete navigation; image-only PDFs are not supported.

## Parser benchmark

The Python 3.12 corpus CLI keeps all licensed inputs and derived book content private and ignored by Git. Install `requirements-corpus.txt`, then use:

```sh
python3 -m tools.corpus_cli sync
python3 -m tools.corpus_cli extract
python3 -m tools.corpus_cli render
python3 -m tools.corpus_cli annotate
python3 -m tools.corpus_cli analyze --parse
python3 -m tools.corpus_cli evaluate --split locked-test --enforce
python3 -m tools.corpus_cli report --split locked-test
```

`sync` accepts only exact Public Domain Mark, CC0, CC BY 3.0, or CC BY 4.0 rights URIs, validates selectable text, deduplicates by identifiers and checksum, and freezes provenance for 300 English OAPEN PDFs. It assigns 150 discovery, 50 development, and 100 locked-test books, with a deterministic 20% double-review sample. Forty Standard Ebooks can be rendered into trade, compact, and two-column control PDFs with EPUB headings as ground truth; their scores stay separate from OAPEN headline results.

The locked scorecard gates title accuracy, chapter/part precision and recall, semantic-section F1, section and reading-start page accuracy, body-word retention, running-furniture leakage, and sentence-boundary F1. Generated PDF fixtures run in CI; the complete licensed corpus is intended for a private runner and blocks parser promotion when any gate regresses.

## Checks

The [local PDF import audit](design/progress-mockups/import-validation.md) records the original failures found in the Dalio PDFs and 7 Habits. Parser version 11 and chapter version 5 now pass the checked prose chapter destinations, reading starts, and forbidden-navigation checks in both extraction modes; see [refactor validation](design/refactor-validation.md). With the private PDF/extraction manifest available, `node tools/validate_local_imports.cjs tmp/import-validation/manifest.json tmp/import-validation/results.json` checks the expected chapter pages in both extraction modes and returns a failing status for unresolved defects. `node tools/check_prose_imports.cjs MANIFEST OUTPUT_JSON` gates the three prose books separately from the chart companion. These private-file checks run separately from the portable unit suite.

Run `npm test` for parser, sentence, resume, progress, persistence, and page-alignment regressions; run `npm run typecheck` for TypeScript checks. After installing the Python requirements, `npm run test:corpus` generates and verifies temporary fixture PDFs, extraction JSON, rendered pages, control layouts, evaluation gates, and a scorecard. On iOS, verify opening a saved book deep into the text, swiping both directions, jumping to a section, closing/reopening, and restarting the app. Each reopen should restore the same text and percentage. Check long text and resizing as well: text must remain accessible and the progress bar must stay clear of the prose and controls. Check chapter marker spacing, paper/sepia/night contrast, and tapping the page to hide/show the bar. VoiceOver should expose the book percentage and current chapter.

## Implementation boundaries

`App.tsx` presents the library/reader and handles document-picker and incoming-URL
UI. `LibraryController` owns the book cache, lifecycle, serialized content writes,
reader sessions and revision checks; `useLibraryController` connects its state to
React. Native, persistence, clock and scheduling dependencies are supplied through
`libraryServices`.

`parseEbook` orchestrates the layout, metadata, section and reading-flow stages in
`src/lib/parser`. `sourceNavigation` supplies destination-checked heading/outline/
contents evidence to both fresh parsing and navigation-only refresh. These adapters
serve different outputs: one creates sections/cards, while the other maps chapters
onto saved cards. Section policy distinguishes reading start, readable optional
content, navigation and progress eligibility.

`useReaderNavigation` owns position commits and paging lifecycle. Reader panels
and shared styles are separate presentation modules. Scan jumps and Undo use the
same navigation operation as chapter jumps. Native `BookPageScanner` owns camera/
OCR lifecycle; `PDFTextExtractorModule` retains the public bridge and extraction.
`paragraphize.ts` contains only saved-book quotation compatibility repair.

The tests-first acceptance baseline, commit gates, known historical failures and
native/device procedures are documented in `design/refactor-validation.md`.
