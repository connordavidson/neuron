import type { BookContent, BookSummary } from '../types';

export function clampReadingIndex(index: number, count: number): number {
  return Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : 0, Math.max(0, count - 1)));
}

export function pageAtOffset(offset: number, height: number, count: number): number {
  return clampReadingIndex(height > 0 ? Math.round(offset / height) : 0, count);
}

// Native lists emit scroll events while mounting, restoring and resizing. Only
// movement that follows a user drag may replace a bookmark; chapter jumps are explicit.
export class ReadingSession {
  index: number;
  private followsDrag = false;

  constructor(index: number, private readonly count: number) {
    this.index = clampReadingIndex(index, count);
  }

  beginDrag(): void { this.followsDrag = true; }
  layoutChanged(): void { this.followsDrag = false; }

  jump(index: number): number {
    this.followsDrag = false;
    this.index = clampReadingIndex(index, this.count);
    return this.index;
  }

  scroll(offset: number, height: number): number {
    if (this.followsDrag && height > 0) this.index = pageAtOffset(offset, height, this.count);
    return this.index;
  }
}

// Built once when loading/importing a book. Progress counts the body text before
// the current page, so a page with two long sentences weighs more than a short one.
export function buildReadingOffsets(content: BookContent): number[] {
  const start = clampReadingIndex(content.readingStart, content.paragraphs.length);
  const offsets = [0];
  for (let index = 0; index < content.paragraphs.length; index += 1) {
    const words = index < start ? 0 : (content.paragraphs[index]?.match(/\S+/gu)?.length ?? 0);
    offsets.push((offsets[index] ?? 0) + words);
  }
  return offsets;
}

export function summaryAtPosition(
  book: BookSummary,
  content: BookContent,
  offsets: number[],
  position = book.currentParagraph,
): BookSummary {
  const count = content.paragraphs.length;
  const index = clampReadingIndex(position, count);
  const start = clampReadingIndex(content.readingStart, count);
  const total = offsets[count] ?? 0;
  const atEnd = count > 1 && index === count - 1 && index > start;
  const progress = atEnd ? 1 : total > 0 ? (offsets[index] ?? 0) / total : 0;
  return {
    ...book,
    currentParagraph: index,
    paragraphCount: count,
    readingStart: start,
    readingProgress: Math.max(0, Math.min(1, progress)),
    currentSourcePage: content.paragraphPages?.[index] != null
      ? content.paragraphPages[index]! + 1
      : undefined,
  };
}

export function displayedProgress(book: BookSummary): { fraction: number; label: string } {
  const index = clampReadingIndex(book.currentParagraph, book.paragraphCount);
  const start = clampReadingIndex(book.readingStart ?? 0, book.paragraphCount);
  const fraction = Math.max(0, Math.min(1, book.readingProgress ??
    (book.paragraphCount - start > 1 ? (index - start) / (book.paragraphCount - start - 1) : 0)));
  // Rounding must not announce completion before the final reading page.
  const label = index <= start ? 'Not started' : fraction >= 1
    ? 'Finished' : `${Math.min(99, Math.round(fraction * 100))}% read`;
  return { fraction, label };
}
