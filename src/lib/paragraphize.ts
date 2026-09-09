const PAGE_NUMBER = /^(?:page\s+)?\d{1,5}(?:\s+(?:of|\/)\s*\d{1,5})?$/i;
const TERMINAL_CHARACTERS = new Set(['.', '!', '?', '…']);
const SENTENCES_PER_READING_PAGE = 2;

// Records the import algorithm. Opening a saved book must never replace its
// content or move its bookmark as a side effect of a version change.
export const PARAGRAPH_PARSER_VERSION = 4;

export type ParagraphRecord = {
  pageIndex: number;
  text: string;
  heading?: string;
};

export function paragraphizePages(pages: string[]): string[] {
  return paragraphizePagesWithMetadata(pages).map(({ text }) => text);
}

export function paragraphizePagesWithMetadata(pages: string[], chapters: SourceChapter[] = []): ParagraphRecord[] {
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

  const result: ParagraphRecord[] = [];
  const sentenceBuffer: Array<{ pageIndex: number; text: string; heading?: string }> = [];
  let headingPrefix = '';

  const flushSentences = () => {
    if (!sentenceBuffer.length) return;
    result.push({
      pageIndex: sentenceBuffer[0]?.pageIndex ?? 0,
      text: sentenceBuffer.map(({ text }) => text).join(' '),
      heading: sentenceBuffer.find(({ heading }) => heading)?.heading,
    });
    sentenceBuffer.length = 0;
  };

  for (const block of blocks) {
    if (block.chapter) {
      // A chapter starts on a fresh card. Its final unpaired sentence stays in
      // that chapter, rather than being joined to the opening of the next one.
      flushSentences();
      headingPrefix = block.chapter;
      continue;
    }
    if (looksLikeHeading(block.text)) {
      headingPrefix = headingPrefix ? `${headingPrefix} ${block.text}` : block.text;
      continue;
    }

    for (const sentence of splitSentences(block.text)) {
      const heading = headingPrefix || undefined;
      headingPrefix = '';
      sentenceBuffer.push({ heading, pageIndex: block.pageIndex, text: sentence });
      if (sentenceBuffer.length === SENTENCES_PER_READING_PAGE) flushSentences();
    }
  }

  flushSentences();
  return result;
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
    if (value.length >= 2 && !isPageNumber(value)) {
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

export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character && isSentenceBoundary(text, index)) {
      let end = index + 1;
      while (end < text.length && /["'”’»）)\]}]/u.test(text[end] ?? '')) end += 1;
      const sentence = text.slice(start, end).trim();
      if (sentence) sentences.push(sentence);
      start = end;
      index = end - 1;
    }
  }

  const remainder = text.slice(start).trim();
  if (remainder) sentences.push(remainder);
  return sentences;
}

function isSentenceBoundary(text: string, index: number): boolean {
  const character = text[index];
  if (!character || !TERMINAL_CHARACTERS.has(character)) return false;

  let nextIndex = index + 1;
  while (nextIndex < text.length && /["'”’»）)\]}]/u.test(text[nextIndex] ?? '')) {
    nextIndex += 1;
  }
  const nextCharacter = text[nextIndex];
  if (nextCharacter && !/\s/.test(nextCharacter)) return false;

  if (character === '.') {
    const previous = text[index - 1] ?? '';
    const nextNonSpace = text.slice(nextIndex).match(/^\s*([A-Za-z])/u)?.[1] ?? '';
    if (/\d/.test(previous) && /\d/.test(nextNonSpace)) return false;

    const prefix = text.slice(0, index + 1);
    const word = prefix.match(/([A-Za-z]{1,8})\.$/u)?.[1]?.toLocaleLowerCase() ?? '';
    if (['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e'].includes(word)) {
      return false;
    }
  }

  return true;
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
  const lastCharacter = line.at(-1);
  return lastCharacter ? TERMINAL_CHARACTERS.has(lastCharacter) : false;
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
import type { SourceChapter } from './bookStructure';
