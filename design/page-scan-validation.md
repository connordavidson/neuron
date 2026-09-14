# Physical page scan validation

## Verified on September 13, 2026

- `npm test`: 82 tests pass, including 21 scan matcher and session regressions.
- `npm run typecheck`: passes.
- Xcode 26.6 Debug simulator build: succeeds for iPhone 17 Pro / iOS 26.2, with the native Vision/VisionKit scanner and camera permission description. No scanner compiler warnings; dependency warnings remain.
- Simulator UI: labeled scan action stays below the prose and clear of the progress rail; instruction sheet names the open ebook and exposes Open camera and Cancel. The system camera permission prompt uses the configured explanation. Denial preserves the reading position and offers Open Settings and Scan again.
- Synthetic long-book benchmark on macOS arm64 / Node 20.20.0: a 260-word noisy scan locates the correct card in a 300,000-word book in 107 ms. Maximum observed interval between 10 ms responsiveness probes was 22 ms. These are desktop observations, not an iPhone performance claim.
- Portable regressions verify automatic jump and Undo through the existing ReadingSession/summaryAtPosition path, reopening the saved position, rejected matches, duplicate taps, cancellation, late results after closing/replacing the reader, and stable user-facing native error messages.

## Physical-device release checks still required

The simulator and synthetic tests do not validate a camera aimed at a real book. On a supported iPhone or iPad with the rebuilt development app:

1. Open an imported text-based PDF; note the current passage and percentage. Allow the camera, scan one physical page, review the crop, and save. Verify the jump lands near the top of the scanned text, even when print/PDF page numbers differ.
2. Test portrait/rotated captures, curved pages, dim light, headers/footers, and modest OCR errors. Scan only one page; saving multiple pages must explain the single-page requirement.
3. Verify a blank/short page, unrelated book, and repeated quotation preserve the original position. Scan again with more surrounding text and verify recovery.
4. Verify Undo restores the exact card and percentage, then close and reopen. Verify a successful jump also survives closing and reopening without Undo.
5. Cancel in the native camera and during matching; background/foreground the app; deny and re-enable camera permission through Open Settings. Verify no stale jumps or duplicate camera presentations.
6. Check paper, sepia, and night themes, large text, and VoiceOver. Confirm scan/Undo controls remain clear of the text and rail, and the modal excludes underlying reader controls from accessibility navigation.
7. Measure matching separately from capture/OCR using a long imported ebook. Target completion within two seconds after OCR while controls remain responsive. Record device model, iOS version, book word count, and timing before claiming the on-device target is met.

The matching thresholds are conservative heuristics, not calibrated confidence probabilities. Larger real-scan fixtures should be added when available without committing copyrighted book content or user scans.
