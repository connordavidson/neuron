# EPUB import validation

Validated September 18, 2026.

## Automated checks

- `npm test`: **201 passed**, including the original 150 tests. Existing PDF parser fixtures remain unchanged.
- `npm run typecheck`: passed.
- `git diff --check`: passed.
- `npx expo export --platform ios --output-dir /tmp/flowreader-epub-bundle`: passed; Hermes iOS bundle generated.
- iOS Release simulator build using `FlowReader.xcworkspace`: passed. The built Info.plist registers both `com.adobe.pdf` and `org.idpf.epub-container`.

Synthetic EPUB 2/3 tests exercise metadata, spine ordering, nested navigation, fragment destinations, multiple chapters in a file, chapters crossing files, missing navigation, front matter, title pages, non-linear resources, footnote links (including EPUB 2 superscripts), captions, tables, image alternatives, Unicode/UTF-16, sentence pairing, source anchors, bookmark remapping, and physical-page text matching.

Failure tests cover damaged ZIPs, incorrect file type hints, traversal paths, archive/text limits, content checksums, XML entities, missing required content, malformed content, image-only books, fixed/mixed layouts, encrypted content, and font-only obfuscation. Lifecycle tests cover picker cancellation, concurrent imports, delayed file moves for both formats, failed copies/moves and storage writes, cleanup, incoming URLs and retries, reopen without parsing, sandbox relocation, deletion, and format-aware reader labels.

## Real-book and simulator checks

Used the public-domain Project Gutenberg edition of [Frankenstein](https://www.gutenberg.org/ebooks/84), downloaded as EPUB 3. The desktop parser produced 2,957 reading cards, recognized the letters and all 24 numbered chapters, selected Letter 1 as the reading start, and completed in approximately 0.4 seconds on this Mac. This is a desktop smoke check, not a phone performance guarantee. Publisher license/header material remains readable and excluded from progress. Downloaded books and parsed content stayed outside the repository.

Also reproduced a second import failure using the user's 62.1 MiB EPUB from the phone's import cache. Its EbookLib-generated package contains 1,212 spine entries, including an undeclared leading `cover` placeholder followed by navigation; every remaining spine resource is present locally. EPUB parser version 2 narrowly tolerates this missing placeholder and records a diagnostic warning. It still rejects missing declared covers, missing body content, other undeclared entries, and remote reading documents, with separate local/remote error messages. The exact file then parsed successfully into 11,366 reading cards in approximately 4.2 seconds on this Mac. Synthetic regression fixtures preserve all body text and navigation while exercising the recovery and its rejection boundaries; the user's book is not committed as a fixture.

Tested a freshly built Release app on an isolated iPhone 17 Pro simulator running iOS 26.5:

- The existing import button opens a picker that offers EPUB files.
- Selecting Frankenstein shows the existing importing overlay and returns to its library entry.
- Opening the entry starts at Letter 1, with the same reading cards, chapter control, progress rail, and Scan page control.
- Chapter navigation shows reading-page labels and jumps successfully to Chapter 10 at 38% progress.
- Night theme and increasing text size to 26 retain the same passage.
- Terminating and reopening the app restores the Chapter 10 passage, 38% progress, theme, and font size from saved content.
- Files identifies FlowReader as an EPUB handler. Its **Open in FlowReader** action imports the book and opens Letter 1 automatically.

## Remaining physical-device checks

The initial validation used a simulator. A subsequent signed Release build was installed and launched on the paired iPhone 15 Pro Max. The user's import then exposed a race: Expo's asynchronous `File.move()` was not awaited before opening the destination. The importer now awaits the move. The corrected test filesystem models asynchronous moves and refuses to open missing files; a delayed-move regression reproduced the original failure before the fix and passes afterward for both formats. Move failures also clean up the staged file without creating a library entry.

Importing the user's EPUB with the fix, iCloud provider downloads, real touch swiping/long-card scrolling, VoiceOver interaction, and camera scanning plus Undo still need a physical-device smoke check. The simulator UI automation could activate controls but did not reliably generate paging drags; it is not evidence of touch-swipe acceptance. Automated navigation, layout, scanner lifecycle, matching, and Undo coverage passes.

## Compatibility and limits

- Existing PDF records retain their storage keys, source pages, saved card layouts, and bookmarks. Missing format information continues to mean PDF.
- EPUB anchors contain source document, spine index, optional element ID, normalized-text offsets, and context. EPUBs never enter PDF chapter refresh or legacy PDF quotation repair.
- This release supports text-focused, DRM-free, reflowable EPUB 2/3. It does not render publisher CSS/fonts, pictures, fixed layouts, multimedia, scripts, or remote resources.
- ZIPs are bounded to 100 MiB compressed and 10,000 entries; extracted textual resources are bounded to 8 MiB each and 64 MiB total. ZIP64/multidisk containers, non-UTF-8/UTF-16 text, unsupported required spine media, and encrypted content fail with an import error. Font obfuscation is allowed because fonts are unused.
- Missing optional navigation falls back to content headings. Required missing or corrupt reading content fails import instead of silently saving a partial book.
- Rebuild the native app to acquire the EPUB document association. Cached content remains stable; reimport a book to regenerate its reading cards with future parser versions.
