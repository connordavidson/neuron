# Right-side reading progress mockups

Three static concepts for FlowReader. Created on `codex/reading-progress-mockups`, based on `feature/corpus-driven-parser`. These are visual design artifacts; no reader code or public interfaces change.

## Concepts

1. **Minimal dots (recommended):** A quiet, thin book-progress rail with chapter boundary dots.
2. **Highlighted chapter:** The same rail with a subtle band between the current chapter's boundaries.
3. **Position label:** A shorter rail with a small percentage/chapter label.

Each comparison shows paper and night screens, matching the existing reader palette, serif passage, and top controls. The sample is fictional: *The Quiet Hours*, Chapter 4, “The Crossing.” All show 42% overall progress and approximately 24% progress through Chapter 4.

## Intended behavior

- Progress fills from top to bottom across the whole book; it does not reset at chapter boundaries.
- Chapter boundary positions follow cumulative book progress, not equal spacing. The fixture boundaries are 0%, 12%, 27%, 38%, 55%, 71%, 89%, and 100%.
- Completed boundaries use solid dots; upcoming boundaries use outlined dots. The current position uses the fill endpoint, distinct from the dots.
- The current chapter is the interval from 38% to 55%. Its highlight, where present, is separate from the completed book fill.
- This is a passive indicator, with no tapping or dragging behavior.
- In a future implementation, reuse the reader's existing body-word progress semantics; mockup fixture values are illustrative, not a new progress calculation.

## Edge cases for eventual implementation

- **Empty progress:** Keep the rail unfilled. The first boundary may identify the start, but must not imply completed reading.
- **Full progress:** Fill to the bottom endpoint with completed chapter markers.
- **Closely spaced boundaries:** Keep proportional positions; merge visually colliding markers into a subtle tick cluster rather than spreading them into false equal distances. Preserve the current chapter bounds where legible.
- **No reliable chapters:** Show the continuous book-progress rail without chapter dots, chapter highlight, or chapter number.
- **Legibility:** Reserve space outside the prose and safe areas, maintain contrast in paper/sepia/night, and distinguish chapter dots from the fill endpoint. The concept comparison covers paper and night; sepia follows existing theme colors.
- **Accessibility:** A future native indicator should expose book percentage and current chapter as accessible text without requiring color recognition.

## Generation

Generated using the built-in image-generation tool. Exact prompts are in the sibling `prompts.md`. Raster mockups communicate visual direction; precise proportional geometry should be implemented with native layout after a concept is chosen.

## Visual review

Reviewed all three paper/night comparisons for readable sample text, a continuous top-anchored fill, distinct solid/hollow chapter markers, and separation from the prose. Refined the highlighted-chapter image to extend the highlight toward both boundary dots. The same sample text and labeled book position appear throughout.

The raster drawings approximate the specified percentages and spacing; they are not pixel-exact native screenshots. The generated chapter-menu glyph is an ellipsis rather than the current app's menu glyph. In the highlighted paper view, strengthen the fill endpoint contrast during native implementation.

## Images

- [01 — Minimal dots](01-minimal-dots.png)
- [02 — Highlighted chapter](02-highlighted-chapter.png)
- [03 — Position label](03-position-label.png)

No executable code changed, so validation consists of visual inspection, PNG format/dimension checks, and repository diff checks rather than app tests.
