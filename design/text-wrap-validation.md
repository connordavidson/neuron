# Deep-book text wrapping

## Regression and fix

At large FlatList offsets, Yoga subtracts float32 absolute coordinates to obtain
local view heights. A paragraph requiring 267.3 points could receive only 267 or
267.25 points thousands of cards into a book. React Native's iOS TextKit container
then clips the last available line, losing the final wrapped word.

`ParagraphPage` now measures the natural Text height once and gives that Text a
minimum height with an allowance for coordinate rounding. `readerTextMinHeight`
uses the float32 spacing at the page's position, with room for loss in both the
initial measurement and the subsequent layout. The allowance is normally two
points, growing only at very large offsets. It does not change the font, line
height, sentence boundaries, book content, or reading position.

Measurements are invalidated for text, font size, accessibility scale, viewport,
and page-index changes. Old callbacks are rejected and subsequent callbacks do
not add the allowance again. Long passages retain the existing internal scroll.

## Verification — September 18, 2026

- All 150 automated tests passed, including regression cases for float32
  rounding at card indices through 100,000, measurement reset, stale callbacks,
  and preventing repeated height growth. TypeScript and `git diff --check` passed.
- An isolated native simulator app used the production ReaderScreen with
  measurement logging and controlled typography. On an iPhone 14 Pro Max running
  iOS 26.5, 100 scenarios covered sizes 18–32 in two-point increments, scale
  factors 0.9, 1, 1.3, and 2, and starting positions 0, 6,000, and 10,000.
  Additional cases used a passage six times as long, plus a final size-22 visual
  check. Every target card passed; 444 settled card layouts, including rendered
  neighbors, matched the beginning-of-book line breaks and had enough height
  for their final line. Offscreen neighbors unmounted before measurement settled
  were excluded from that count.
- The supplied Behave sentence now displays its final word on a ninth line at
  size 22 / scale 0.9 at card 6,000. The screenshot was visually inspected.
- On the same mounted reader at card 6,000, sizes 22 -> 32 -> 18 -> 22,
  scaling 0.9 -> 1.3, a width change from 430 to 390 points, and restoration to
  the original settings all retained the final word. Heights grew and shrank
  correctly; returning to size 22 restored the original nine-line layout.

Private reproduction text, simulator harnesses, raw layout events, and screenshots
remain ignored under `tmp/wrap-diagnostics` and `tmp/wrap-fix-validation`.

This is a JavaScript change; it does not require book reimport or a native module
change. A development build must reload the updated bundle; an installed Release
build must be rebuilt/reinstalled to include it. Validation used an isolated
simulator app and did not update the physical iPhone's installed app.
