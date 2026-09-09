# neuron

neuron is a new type of ebook reader. The current app, FlowReader, is a React Native iOS reader that imports text-based ebook PDFs and turns them into a focused, vertical, two-sentence feed.

## What it does

- Imports PDFs from Files, iCloud Drive, and other iOS document providers
- Extracts text locally with Apple's PDFKit (books never leave the device)
- Repairs wrapped lines, hyphenation, page numbers, and repeated page headers
- Snaps each vertical swipe to the next two-sentence reading page
- Uses PDF bookmarks when available, then page-aware text signals for chapter navigation
- Skips only confidently identified front matter on first open
- Provides a chapter picker for quick navigation
- Saves the visible reading page automatically, including when the app is backgrounded
- Opens cached book content without reparsing or replacing it during a reading session
- Measures reading progress by body-text word counts and retains PDF page numbers on new imports
- Includes paper, sepia, and night themes plus adjustable text sizing
- Stores and searches a local book library
- Sorts books by most recently read
- Keeps closing quotation marks attached to their sentences, including repairs for older imports without shifting bookmarks

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

The importer requires a PDF with a selectable text layer. Image-only scans need OCR before import. PDF text often contains visual line breaks instead of semantic paragraphs, so FlowReader repairs the text, detects sentence boundaries across PDF page breaks, and groups each complete reading page into exactly two sentences. A final leftover sentence may stand alone.

All reading pages use the selected font size. Exceptionally long sentence pairs can scroll within their page. The swipe indicator stays at the bottom of the reader. A chapter's final unpaired sentence also stands alone so the next chapter starts on a fresh card.

Chapter detection combines PDF bookmarks, contents-page destinations, explicit headings, and font-size signals. Existing imports receive navigation-only updates in the background: their reading cards and saved positions are not rebuilt. PDF structure varies, so missing or unreliable text may still produce incomplete navigation; image-only PDFs are not supported.

## Checks

Run `npm test` for resume, progress, persistence, and page-alignment regressions, and `npm run typecheck` for TypeScript checks. On iOS, verify opening a saved book deep into the text, swiping both directions, jumping to a chapter, closing/reopening, and restarting the app. Each reopen should restore the same text and percentage. Check long text and rotation as well: text must remain accessible and the indicator must stay at the bottom.
