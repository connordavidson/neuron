import type { Chapter } from '../types';

export const CHAPTER_VERSION = 5;
import { clean, EXPLICIT, SPECIAL, headingKey, detectSourceChapters, collectChapterEvidence, type SourceChapter, type OutlineItem } from './sourceNavigation';
export { headingKey, detectSourceChapters, type SourceChapter, type OutlineItem } from './sourceNavigation';
export type BookStructureOptions = {
  outlines?: OutlineItem[];
  paragraphPages?: number[];
  chapterMarkers?: Chapter[];
  sourcePages?: string[];
  pageLineFonts?: number[][];
  sourceChapters?: SourceChapter[];
};
export type BookStructure = { chapters: Chapter[]; readingStart: number };
export function detectBookStructure(paragraphs: string[], options: BookStructureOptions = {}): BookStructure {
  const source = options.sourceChapters ?? collectChapterEvidence(options.sourcePages ?? [], options.outlines, options.pageLineFonts)
    .filter(candidate => candidate.confidence >= 0.62);
  const chapters: Chapter[] = [];
  const normalized = paragraphs.map(headingKey);
  for (const item of source) {
    const indices = options.paragraphPages?.flatMap((page, index) => page === item.pageIndex ? [index] : []) ?? [];
    let paragraphIndex: number | undefined;
    const key = headingKey(item.title);
    // Restrict title matching to its destination, avoiding printed TOC duplicates.
    paragraphIndex = indices.find((index) => normalized[index]?.includes(key));
    if (paragraphIndex == null && options.sourcePages?.length) {
      const bodyLines = (options.sourcePages[item.pageIndex] ?? '').split('\n').slice(item.endLineIndex);
      const anchor = headingKey(bodyLines.join(' '));
      for (let offset = 0; offset < Math.min(anchor.length, 360) && paragraphIndex == null; offset += 24) {
        const phrase = anchor.slice(offset, offset + 60);
        if (phrase.length < 30) break;
        paragraphIndex = (indices.length ? indices : normalized.map((_text, index) => index))
          .find((index) => normalized[index]?.includes(phrase));
      }
    }
    if (paragraphIndex == null && indices.length) paragraphIndex = indices[0];
    // Heading-only pages may yield no card; land on the first following text.
    if (paragraphIndex == null && options.paragraphPages?.length) {
      paragraphIndex = options.paragraphPages.findIndex((page) => page >= item.pageIndex);
      if (paragraphIndex < 0) paragraphIndex = undefined;
    }
    if (paragraphIndex != null && paragraphs[paragraphIndex]?.trim()) {
      chapters.push({ paragraphIndex, title: item.title, pageIndex: item.pageIndex, kind: item.kind, level: item.level ?? 0 });
    }
  }
  if (!chapters.length && !options.sourcePages?.length) {
    for (const marker of options.chapterMarkers ?? []) {
      if (EXPLICIT.test(clean(marker.title)) || SPECIAL.test(clean(marker.title))) chapters.push(marker);
    }
  }
  const ordered = chapters.sort((a, b) => a.paragraphIndex - b.paragraphIndex || (a.pageIndex ?? 0) - (b.pageIndex ?? 0)
    || (a.kind === 'part' ? -1 : b.kind === 'part' ? 1 : 0));
  return { chapters: ordered, readingStart: ordered.find((item) => item.kind !== 'frontMatter' && item.kind !== 'backMatter')?.paragraphIndex ?? 0 };
}

export function currentChapterAt(chapters: Chapter[], index: number): Chapter | undefined {
  let current: Chapter | undefined;
  for (const chapter of chapters) {
    if (chapter.paragraphIndex > index) break;
    current = chapter;
  }
  return current;
}
