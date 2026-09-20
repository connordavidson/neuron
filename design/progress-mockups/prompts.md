# Generation prompts

## 01-minimal-dots

```text
Use case: ui-mockup.
Create a polished STATIC UI design comparison image for the existing Neuron iOS ebook reader. Landscape canvas, high resolution, crisp readable typography. Two large identical flat portrait iPhone screen mockups side by side, PAPER left and NIGHT right, on a quiet light neutral presentation background. These are app screens with rounded corners, not photorealistic devices, no perspective, no hands, no decorative illustrations. Keep phone screens large enough to read. Under each screen add a small exterior label "PAPER" / "NIGHT".
Preserve existing app: small top iOS status time 9:41 and understated status icons, top navigation row with circular back chevron at left, centered title "The Quiet Hours" and smaller subtitle "Chapter 4 · The Crossing", small chapters menu and Aa controls at right. Center an elegant left-aligned Georgia-like serif passage vertically in ample empty space. Both phones must contain exactly the same two-sentence passage with the same line breaks:
"The path followed the river
until the last houses fell
behind us. Ahead, the hills
rose slowly into the pale
morning light."
No additional body prose. No bottom toolbar. Small native home indicator inside bottom safe area.
PAPER colors: background #F8F6F0, text #1F1D19, secondary #777169. NIGHT: background #101116, text #E7E8ED, secondary #8D909C. Avoid gradients, saturated purple, heavy shadows and big interface cards.
The only new UI is a very slim vertical reading progress track INSIDE the far right edge, safely separated from the text with adequate margin. Track fill is anchored at the TOP and grows DOWN; this is cumulative book progress, NOT a floating scrollbar thumb. At exactly 42% book progress, the upper 42% of the rail is solid muted ink (paper) or soft light gray (night); lower 58% is faint unfilled track. Rail 3px wide at phone scale. Eight tiny chapter boundary dots at proportional vertical positions 0%,12%,27%,38%,55%,71%,89%,100% of the rail; they MUST be visibly unevenly spaced. Completed dots up to 38% are solid. Future dots 55%,71%,89%,100% are hollow. Current position is 42%, between the 38% and 55% chapter dots; fill endpoint is a small horizontal cap, visually distinct from chapter dots. This is Chapter 4, about 24% through that chapter. Never put a chapter dot exactly at the fill endpoint.
Every phone shows the SAME sample text, same 42% reading position, and same chapter boundary distribution. Progress bar stays secondary to text; ensure there is NO overlap with prose, controls or safe areas.

DIRECTION 01: MINIMAL DOTS. Outside phones, presentation title exactly "01 / Minimal dots"; small subtitle "Book progress, chapter by chapter". The right-side rail spans about 60% of the usable screen height, vertically centered below navigation. Tiny 5px chapter dots and a 3px track. No percentage badge, chapter-region highlight or second bar. This is the cleanest and quietest option. Beneath the two phone mockups, a small exterior annotation reads "42% of book · Chapter 4". All presentation labels should be clean sans serif.
```

## 02-highlighted-chapter

```text
Use case: ui-mockup.
Create a polished STATIC UI design comparison image for the existing Neuron iOS ebook reader. Landscape canvas, high resolution, crisp readable typography. Two large identical flat portrait iPhone screen mockups side by side, PAPER left and NIGHT right, on a quiet light neutral presentation background. These are app screens with rounded corners, not photorealistic devices, no perspective, no hands, no decorative illustrations. Keep phone screens large enough to read. Under each screen add a small exterior label "PAPER" / "NIGHT".
Preserve existing app: small top iOS status time 9:41 and understated status icons, top navigation row with circular back chevron at left, centered title "The Quiet Hours" and smaller subtitle "Chapter 4 · The Crossing", small chapters menu and Aa controls at right. Center an elegant left-aligned Georgia-like serif passage vertically in ample empty space. Both phones must contain exactly the same two-sentence passage with the same line breaks:
"The path followed the river
until the last houses fell
behind us. Ahead, the hills
rose slowly into the pale
morning light."
No additional body prose. No bottom toolbar. Small native home indicator inside bottom safe area.
PAPER colors: background #F8F6F0, text #1F1D19, secondary #777169. NIGHT: background #101116, text #E7E8ED, secondary #8D909C. Avoid gradients, saturated purple, heavy shadows and big interface cards.
The only new UI is a very slim vertical reading progress track INSIDE the far right edge, safely separated from the text with adequate margin. Track fill is anchored at the TOP and grows DOWN; this is cumulative book progress, NOT a floating scrollbar thumb. At exactly 42% book progress, the upper 42% of the rail is solid muted ink (paper) or soft light gray (night); lower 58% is faint unfilled track. Rail 3px wide at phone scale. Eight tiny chapter boundary dots at proportional vertical positions 0%,12%,27%,38%,55%,71%,89%,100% of the rail; they MUST be visibly unevenly spaced. Completed dots up to 38% are solid. Future dots 55%,71%,89%,100% are hollow. Current position is 42%, between the 38% and 55% chapter dots; fill endpoint is a small horizontal cap, visually distinct from chapter dots. This is Chapter 4, about 24% through that chapter. Never put a chapter dot exactly at the fill endpoint.
Every phone shows the SAME sample text, same 42% reading position, and same chapter boundary distribution. Progress bar stays secondary to text; ensure there is NO overlap with prose, controls or safe areas.

DIRECTION 02: HIGHLIGHTED CHAPTER. Outside phones, presentation title exactly "02 / Highlighted chapter"; small subtitle "A little more context for the current chapter". The right-side rail spans about 60% of the usable screen height, vertically centered below navigation. Same thin rail and dot geometry as Minimal dots. Add a narrow subtle translucent rounded band directly behind the rail spanning ONLY from the chapter dot at 38% to the chapter dot at 55%; this small band highlights the current chapter. It must NOT extend over the entire rail. The cumulative filled rail still runs from 0% down to exactly 42%, stopping inside this chapter band. Band 12px wide at phone scale, quietly distinguishable on both themes. Do not add a second progress bar or badge. Beneath the mockups, small exterior annotation reads "42% of book · Chapter 4". All presentation labels clean sans serif.
```

## 03-position-label

```text
Use case: ui-mockup.
Create a polished STATIC UI design comparison image for the existing Neuron iOS ebook reader. Landscape canvas, high resolution, crisp readable typography. Two large identical flat portrait iPhone screen mockups side by side, PAPER left and NIGHT right, on a quiet light neutral presentation background. These are app screens with rounded corners, not photorealistic devices, no perspective, no hands, no decorative illustrations. Keep phone screens large enough to read. Under each screen add a small exterior label "PAPER" / "NIGHT".
Preserve existing app: small top iOS status time 9:41 and understated status icons, top navigation row with circular back chevron at left, centered title "The Quiet Hours" and smaller subtitle "Chapter 4 · The Crossing", small chapters menu and Aa controls at right. Center an elegant left-aligned Georgia-like serif passage vertically in ample empty space. Both phones must contain exactly the same two-sentence passage with the same line breaks:
"The path followed the river
until the last houses fell
behind us. Ahead, the hills
rose slowly into the pale
morning light."
No additional body prose. No bottom toolbar. Small native home indicator inside bottom safe area.
PAPER colors: background #F8F6F0, text #1F1D19, secondary #777169. NIGHT: background #101116, text #E7E8ED, secondary #8D909C. Avoid gradients, saturated purple, heavy shadows and big interface cards.
The only new UI is a very slim vertical reading progress track INSIDE the far right edge, safely separated from the text with adequate margin. Track fill is anchored at the TOP and grows DOWN; this is cumulative book progress, NOT a floating scrollbar thumb. At exactly 42% book progress, the upper 42% of the rail is solid muted ink (paper) or soft light gray (night); lower 58% is faint unfilled track. Rail 3px wide at phone scale. Eight tiny chapter boundary dots at proportional vertical positions 0%,12%,27%,38%,55%,71%,89%,100% of the rail; they MUST be visibly unevenly spaced. Completed dots up to 38% are solid. Future dots 55%,71%,89%,100% are hollow. Current position is 42%, between the 38% and 55% chapter dots; fill endpoint is a small horizontal cap, visually distinct from chapter dots. This is Chapter 4, about 24% through that chapter. Never put a chapter dot exactly at the fill endpoint.
Every phone shows the SAME sample text, same 42% reading position, and same chapter boundary distribution. Progress bar stays secondary to text; ensure there is NO overlap with prose, controls or safe areas.

DIRECTION 03: POSITION LABEL. Outside phones, presentation title exactly "03 / Position label"; small subtitle "Precise progress at a glance". The right-side rail is compact, spanning about 36% of usable screen height, positioned at the upper right beneath the top navigation and entirely above the vertically centered body passage so the label does not overlap prose. Same top-to-bottom fill, eight uneven chapter dots, and 42% position. Add a very small subdued pill to the LEFT of the fill endpoint, with EXACT text "42% · Ch 4" in 10px sans serif at phone scale. The pill is anchored to 42% of the rail height, modest and visually quiet. No chapter-region highlight and no second bar. Beneath the mockups, small exterior annotation reads "42% of book · Chapter 4". All presentation labels clean sans serif.
```
