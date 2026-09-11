# neuron

neuron is a new type of ebook reader. The current app, FlowReader, is a React Native iOS reader that imports text-based ebook PDFs and turns them into a focused, vertical, two-sentence feed.

## What it does

- Imports PDFs from Files, iCloud Drive, and other iOS document providers
- Extracts text locally with Apple's PDFKit (books never leave the device)
- Reconstructs columns, lines, paragraphs, reading order, and page-spanning prose from PDF geometry
- Detects and removes running headers, footers, and page numbers by position, style, and document-wide repetition
- Snaps each vertical swipe to the next two-sentence reading page
- Fuses PDF outlines, spatial contents entries, numbering, typography, whitespace, alignment, and document position for navigation
- Detects title-page metadata plus front matter, chapters, parts, appendices, notes, references, indexes, and other semantic sections
- Skips only confidently identified front matter on first open
- Provides a chapter picker for quick navigation
- Saves the visible reading page automatically, including when the app is backgrounded
- Opens cached book content without reparsing or replacing it during a reading session
- Measures reading progress by body-text word counts and retains PDF page numbers on new imports
- Includes paper, sepia, and night themes plus adjustable text sizing
- Stores and searches a local book library
- Sorts books by most recently read
- Swipe left on a book to reveal Delete; removal still requires confirmation
- Keeps closing quotation marks attached to their sentences, including repairs for older imports without shifting bookmarks
- Keeps footnotes, captions, tables, and references as contextual notes instead of mixing them into the main prose feed
- Anchors bookmarks to the PDF page, source offset, and a normalized context hash

## Run on iOS

Use Xcode 26.2 (the tested version) and Node 20.19.4 or newer.

```sh
nvm use
npm install
npm run ios
```

The first iOS run generates the native project and links the local PDFKit module. Because FlowReader includes custom native code, use the generated development build rather than Expo Go. After that, `npm start` starts the development server for fast refresh.

For a physical iPhone, connect and trust it, enable Developer Mode, then run `npm run ios -- --device`. Choose your device and configure your Apple development team/signing in Xcode if prompted. The phone and computer should be on the same network while using the development server. Change the bundle identifier and Apple team in `app.json` for your own distribution.

## PDF support

The importer requires a PDF with a selectable text layer. Image-only scans need OCR before import. PDF text often contains visual line breaks instead of semantic paragraphs. FlowReader joins continuous text within each chapter, uses Apple's on-device Natural Language sentence tokenizer, and filters its boundaries for PDF ellipses, closing quotes, dialogue attribution, and initials. Ellipses such as `...`, `. . .`, and `…` are treated as a unit, never as individual sentences. Each complete reading page pairs two detected sentences; a final leftover sentence may stand alone. Ambiguous punctuation can still require interpretation.

Parser changes apply automatically to new imports. Existing books retain their card layout and bookmark. Use **Improve parsing** in Reading settings to opt into a reparse; the app installs the new layout only when it can remap the current source anchor with at least 90% confidence.

All reading pages use the selected font size. Exceptionally long sentence pairs can scroll within their page. The swipe indicator stays at the bottom of the reader. A chapter's final unpaired sentence also stands alone so the next chapter starts on a fresh card.

Uncertain navigation candidates are suppressed rather than presented as chapters. Every accepted metadata and structure value stores confidence and evidence, and every block and reading unit links back to its original PDF page and source range. PDF structure varies, so missing or unreliable text may still produce incomplete navigation; image-only PDFs are not supported.

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

Run `npm test` for parser, sentence, resume, progress, persistence, and page-alignment regressions; run `npm run typecheck` for TypeScript checks. After installing the Python requirements, `npm run test:corpus` generates and verifies temporary fixture PDFs, extraction JSON, rendered pages, control layouts, evaluation gates, and a scorecard. On iOS, verify opening a saved book deep into the text, swiping both directions, jumping to a section, closing/reopening, and restarting the app. Each reopen should restore the same text and percentage. Check long text and rotation as well: text must remain accessible and the indicator must stay at the bottom.
