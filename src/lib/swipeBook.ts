export const DELETE_REVEAL_WIDTH = 88;
export function isHorizontalSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5;
}
export function swipeOffset(start: number, dx: number): number {
  return Math.max(-DELETE_REVEAL_WIDTH, Math.min(0, start + dx));
}
export function shouldRevealDelete(offset: number, velocity: number): boolean {
  if (velocity > 0.4) return false;
  return velocity < -0.4 || offset < -DELETE_REVEAL_WIDTH / 2;
}
