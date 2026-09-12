# Parser 8 targeted regression check

September 12, 2026. This is a targeted development check, not a locked-test
scorecard or a claim that the corpus acceptance gates have been met.

## Changes

- Retain front matter and dedicated notes, bibliography, index, and credits
  sections as readable content. First open still selects the introduction/body.
- Exclude optional copyright, notes, bibliography, and index text from the
  main reading-progress denominator.
- Confirm numbered PDF outline entries against separately styled chapter titles;
  tolerate inside-word extraction spaces only while matching destination headings.
- Avoid interpreting lowercase prose chapter references as automatic headings.
- Do not select a large contents entry as the book title.
- Index reading-unit destinations once for contextual attachment rather than
  sorting every reading unit for every supplement.

## Verification

- TypeScript check: passed. App regression tests: 49 passed.
- Generated corpus-tool tests: 8 passed, including the expected timeout case.
- Private 1,209-page Behave PDF: macOS PDFKit diagnostic replay found all 17
  numbered main chapters at their outline destination pages. Copyright,
  contents, notes, and illustration credits have reading destinations.
- Rebuilt the iOS development app to include structured native extraction.
  A fresh simulator import completed with the correct metadata title, opened
  at the introduction (PDF page 8), and listed all 17 main chapters.
- Simulator copyright jump rendered the actual text (PDF page 4). Returning to
  the library and reopening restored that copyright card with zero progress.
- The original saved import and bookmark were not reflowed or replaced.

The local diagnostic extractor can be run on macOS with:

```sh
swift tools/extract_pdfkit.swift INPUT.pdf tmp/private-check/extraction.json
node tools/run_parser.cjs tmp/private-check/extraction.json tmp/private-check/parsed.json
```

It uses AppKit/PDFKit and omits link extraction; it does not substitute for the
iOS extractor or Apple's iOS sentence tokenizer. Keep source PDFs and output
inside ignored/private locations. No proprietary text is included here.

Known limitations: some PDF kerning and drop-cap spaces remain in rendered text;
unnumbered subsection typography still needs broader validation. The 50-book
revision-7 measurements remain historical and have not been replaced with
revision-8 accuracy claims. Locked-test promotion remains unapproved.
