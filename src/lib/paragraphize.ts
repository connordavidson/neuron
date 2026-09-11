import type { SourceChapter } from './bookStructure';
import { sentenceSpans } from './sentences';
export { splitSentences } from './sentences';
const PAGE_NUMBER = /^(?:page\s+)?\d{1,5}(?:\s+(?:of|\/)\s*\d{1,5})?$/i;
const SENTENCES_PER_READING_PAGE = 2;

// Records the import algorithm. Opening a saved book must never replace its
// content or move its bookmark as a side effect of a version change.
export const PARAGRAPH_PARSER_VERSION = 5;

export type ParagraphRecord = {
  pageIndex: number;
  text: string;
  heading?: string;
};

export function paragraphizePages(pages: string[]): string[] {
  return paragraphizePagesWithMetadata(pages).map(({ text }) => text);
}

type Passage = { text: string; heading?: string; pages: Array<{ start: number; pageIndex: number }> };

function preparePassages(pages: string[], chapters: SourceChapter[]): Passage[] {
  const normalizedPages = normalizePageSequence(pages.map(normalizePage));
  const repeatedEdges = findRepeatedPageFurniture(normalizedPages);
  const blocks: Array<{ pageIndex: number; text: string; chapter?: string }> = [];
  pages.forEach((page, pageIndex) => {
    const boundaries = chapters.filter((chapter) => chapter.pageIndex === pageIndex)
      .sort((a, b) => a.lineIndex - b.lineIndex);
    if (!boundaries.length) {
      blocks.push(...paragraphizePage(normalizedPages[pageIndex] ?? '', repeatedEdges).map((text) => ({ pageIndex, text })));
      return;
    }
    const lines = page.split('\n');
    let start = 0;
    for (const boundary of boundaries) {
      if (boundary.lineIndex > start) {
        blocks.push(...paragraphizePage(normalizePage(lines.slice(start, boundary.lineIndex).join('\n')), repeatedEdges)
          .map((text) => ({ pageIndex, text })));
      }
      blocks.push({ pageIndex, text: '', chapter: boundary.title });
      start = Math.max(start, boundary.endLineIndex, boundary.lineIndex);
    }
    blocks.push(...paragraphizePage(normalizePage(lines.slice(start).join('\n')), repeatedEdges)
      .map((text) => ({ pageIndex, text })));
  });

  const result: Passage[] = [];
  let passage: Passage = { text: '', pages: [] };
  let headingPrefix = '';
  for (const block of blocks) {
    if (block.chapter) {
      if (passage.text) result.push(passage);
      passage = { text: '', pages: [] };
      headingPrefix = block.chapter;
      continue;
    }
    if (looksLikeHeading(block.text)) {
      headingPrefix = headingPrefix ? `${headingPrefix} ${block.text}` : block.text;
      continue;
    }

    if (!passage.text) passage.heading = headingPrefix || undefined;
    headingPrefix = '';
    if (passage.text) passage.text += ' ';
    passage.pages.push({ start: passage.text.length, pageIndex: block.pageIndex });
    passage.text += block.text;
  }
  if (passage.text) result.push(passage);
  return result;
}

function cardsFromPassages(passages: Passage[], boundaries?: number[][]): ParagraphRecord[] {
  return passages.flatMap((passage, passageIndex) => {
    const sentences = sentenceSpans(passage.text, boundaries?.[passageIndex]);
    const result: ParagraphRecord[] = [];
    let sourceIndex = 0;
    for (let i = 0; i < sentences.length; i += SENTENCES_PER_READING_PAGE) {
      const first = sentences[i]!;
      while (sourceIndex + 1 < passage.pages.length && passage.pages[sourceIndex + 1]!.start <= first.start) sourceIndex++;
      result.push({ text: sentences.slice(i, i + SENTENCES_PER_READING_PAGE).map(s => s.text).join(' '),
        pageIndex: passage.pages[sourceIndex]?.pageIndex ?? 0, heading: i === 0 ? passage.heading : undefined });
    }
    return result;
  });
}

export function paragraphizePagesWithMetadata(pages: string[], chapters: SourceChapter[] = []): ParagraphRecord[] {
  return cardsFromPassages(preparePassages(pages, chapters));
}

export async function paragraphizeWithTokenizer(pages: string[], chapters: SourceChapter[],
  tokenize: (texts: string[]) => Promise<number[][]>): Promise<ParagraphRecord[]> {
  const passages = preparePassages(pages, chapters);
  const boundaries = await tokenize(passages.map(passage => passage.text));
  if (boundaries.length !== passages.length) throw new Error('Sentence analysis returned incomplete results. Please try importing again.');
  return cardsFromPassages(passages, boundaries);
}

function normalizePage(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const repaired: string[] = [];

  for (const line of lines) {
    const previousIndex = repaired.length - 1;
    const previous = repaired[previousIndex];
    const firstCharacter = line.trimStart()[0];

    if (
      previous &&
      previous.endsWith('-') &&
      firstCharacter &&
      firstCharacter === firstCharacter.toLocaleLowerCase() &&
      firstCharacter !== firstCharacter.toLocaleUpperCase()
    ) {
      repaired[previousIndex] = previous.slice(0, -1) + line.trimStart();
    } else {
      repaired.push(line);
    }
  }

  return repaired.join('\n');
}

function findRepeatedPageFurniture(pages: string[]): Set<string> {
  if (pages.length < 4) return new Set();

  const counts = new Map<string, number>();
  for (const page of pages) {
    const lines = nonemptyLines(page);
    const edges = [lines[0], lines.at(-1)].filter((line): line is string => Boolean(line));
    for (const edge of new Set(edges)) {
      const key = noiseKey(edge);
      if (key.length >= 3) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.ceil(pages.length * 0.4));
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([line]) => line),
  );
}

function paragraphizePage(page: string, repeatedEdges: Set<string>): string[] {
  const rawLines = page.split('\n');
  const lengths = rawLines
    .map(cleanLine)
    .filter(Boolean)
    .map((line) => line.length)
    .sort((a, b) => a - b);
  const medianLineLength = lengths[Math.floor(lengths.length / 2)] ?? 72;

  const result: string[] = [];
  let buffer = '';

  const flush = () => {
    const value = normalizeWhitespace(buffer);
    if (value.length > 0 && !isPageNumber(value)) {
      result.push(value);
    }
    buffer = '';
  };

  for (const rawLine of rawLines) {
    const line = cleanLine(rawLine);

    if (!line) {
      flush();
      continue;
    }
    if (repeatedEdges.has(noiseKey(line)) || isPageNumber(line)) continue;

    if (!buffer && looksLikeHeading(line)) {
      result.push(line);
      continue;
    }

    buffer = buffer ? `${buffer} ${line}` : line;
    const isShortFinalLine = line.length < Math.max(30, Math.floor(medianLineLength * 0.72));
    if (endsWithTerminalPunctuation(line) && isShortFinalLine) {
      flush();
    }
  }

  flush();
  return result;
}

// Repair the old boundary bug in already-imported books without changing page
// counts, chapter indices, or bookmarks. An opening quote attached to a word is
// deliberately not moved.
export function repairQuotationBoundaries(paragraphs: string[]): string[] {
  const repaired = [...paragraphs];
  for (let i = 1; i < repaired.length; i += 1) {
    const previous = repaired[i - 1] ?? '';
    const current = repaired[i] ?? '';
    const closing = current.match(/^(?:[”’»）)\]}]+|["']+(?=\s|$))/u)?.[0];
    if (!closing || !/[.!?…]["'”’»）)\]}]*$/u.test(previous)) continue;
    const remaining = current.slice(closing.length).trimStart();
    if (!remaining) continue;
    repaired[i - 1] = previous + closing;
    repaired[i] = remaining;
  }
  return repaired;
}

function normalizePageSequence(pages: string[]): string[] {
  const normalized = [...pages];
  for (let index = 1; index < normalized.length; index += 1) {
    const previousLines = normalized[index - 1]?.split('\n') ?? [];
    const nextLines = normalized[index]?.split('\n') ?? [];
    const previousLineIndex = previousLines.length - 1;
    const nextLine = nextLines[0] ?? '';
    const previousLine = previousLines[previousLineIndex] ?? '';
    const firstCharacter = nextLine.trimStart()[0];

    if (
      previousLine.endsWith('-') &&
      firstCharacter &&
      firstCharacter === firstCharacter.toLocaleLowerCase() &&
      firstCharacter !== firstCharacter.toLocaleUpperCase()
    ) {
      previousLines[previousLineIndex] = previousLine.slice(0, -1) + nextLine.trimStart();
      nextLines.shift();
      normalized[index - 1] = previousLines.join('\n');
      normalized[index] = nextLines.join('\n');
    }
  }
  return normalized;
}

function nonemptyLines(page: string): string[] {
  return page.split('\n').map(cleanLine).filter(Boolean);
}

function cleanLine(line: string): string {
  return line.trim();
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function noiseKey(line: string): string {
  return normalizeWhitespace(line).toLocaleLowerCase();
}

function isPageNumber(line: string): boolean {
  return PAGE_NUMBER.test(line);
}

function endsWithTerminalPunctuation(line: string): boolean {
  return /[.!?…。！？]["'”’»）)\]}]*$/u.test(line);
}

function looksLikeHeading(line: string): boolean {
  if (line.length > 64 || endsWithTerminalPunctuation(line)) return false;
  const words = line.split(/\s+/);
  if (words.length < 1 || words.length > 9) return false;

  const letters = [...line].filter(
    (character) => character.toLocaleLowerCase() !== character.toLocaleUpperCase(),
  );
  const isAllCaps =
    letters.length > 0 && letters.every((letter) => letter === letter.toLocaleUpperCase());
  const capitalizedWords = words.filter((word) => {
    const firstCharacter = [...word].find(
      (character) => character.toLocaleLowerCase() !== character.toLocaleUpperCase(),
    );
    return firstCharacter ? firstCharacter === firstCharacter.toLocaleUpperCase() : false;
  }).length;

  return isAllCaps || capitalizedWords === words.length;
}
