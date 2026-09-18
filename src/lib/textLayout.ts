/**
 * Yoga rounds absolute top/bottom coordinates to float32 before subtracting
 * them. Deep in a paged book this can shorten a Text by part of a point, causing
 * iOS to clip its final line. Allow for that loss both in the measured height
 * and in the subsequent layout, without changing the font or the book text.
 */
export function readerTextMinHeight(measuredHeight: number, pageBottom: number): number {
  const extent = Math.max(1, Math.abs(pageBottom) + measuredHeight);
  const roundingStep = 2 ** Math.max(0, Math.floor(Math.log2(extent)) - 23);
  return Math.ceil(measuredHeight) + 2 * roundingStep;
}
