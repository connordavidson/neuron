const FRONT_MATTER = /^(?:cover|contents|table of contents|copyright|dedication|title page|also by|acknowledg(?:e)?ments?|about the author|author'?s note|publisher'?s note|isbn)\b/i;
const CHAPTER_MARKER = /^(?:chapter|part|prologue|epilogue|appendix|afterword|introduction)(?:\s|$)/i;

export function inferBookTitle(
  metadataTitle: string,
  originalFileName: string,
  pages: string[],
): string {
  const fallback = stripExtension(originalFileName).trim() || 'Untitled book';
  const documentTitle = cleanTitle(metadataTitle);
  if (isUsableTitle(documentTitle, fallback)) return documentTitle;

  const firstPageTitle = titleFromOpeningPage(pages[0] ?? '');
  return firstPageTitle || fallback;
}

function titleFromOpeningPage(page: string): string {
  const lines = page
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 12);
  const titleLines: string[] = [];

  for (const line of lines) {
    if (isByline(line) || isFrontMatter(line) || isChapterMarker(line)) {
      if (titleLines.length) break;
      continue;
    }
    if (isBodyLine(line)) break;
    if (isTitleLine(line)) titleLines.push(line);
    if (titleLines.length === 3) break;
  }

  const title = cleanTitle(titleLines.join(' '));
  return title.split(/\s+/).length <= 14 && title.length >= 3 ? title : '';
}

function isTitleLine(line: string): boolean {
  if (line.length < 3 || line.length > 96 || /[.!?…]$/.test(line)) return false;
  if (/^\d{1,5}(?:\s+of\s+\d{1,5})?$/i.test(line)) return false;
  if (/^(?:by|written|a novel|a memoir|an?\s+(?:ebook|edition))\b/i.test(line)) {
    return /^a\s+(?:novel|memoir)\b/i.test(line);
  }

  const words = line.split(/\s+/);
  if (words.length > 10) return false;
  const letters = [...line].filter(
    (character) => character.toLocaleLowerCase() !== character.toLocaleUpperCase(),
  );
  const allCaps = letters.length >= 3 && letters.every((letter) => letter === letter.toLocaleUpperCase());
  const titleCaseWords = words.filter((word) => {
    const firstLetter = [...word].find(
      (character) => character.toLocaleLowerCase() !== character.toLocaleUpperCase(),
    );
    return firstLetter ? firstLetter === firstLetter.toLocaleUpperCase() : false;
  }).length;
  return allCaps || titleCaseWords >= Math.max(1, words.length - 1);
}

function isBodyLine(line: string): boolean {
  return line.length > 120 || /[.!?…]["'”’)]?\s+\S/.test(line);
}

function isByline(line: string): boolean {
  return /^(?:by|written\s+by|edited\s+by)\b/i.test(line);
}

function isFrontMatter(line: string): boolean {
  return (
    FRONT_MATTER.test(line) ||
    /^(?:©|all rights reserved|published by|printed in|library of congress|www\.|https?:\/\/)/i.test(line) ||
    /\b(?:isbn|copyright)\b/i.test(line)
  );
}

function isChapterMarker(line: string): boolean {
  return CHAPTER_MARKER.test(line);
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

function isUsableTitle(title: string, fallback: string): boolean {
  if (!title || title.toLocaleLowerCase() === fallback.toLocaleLowerCase()) return false;
  return !/^(?:untitled|unknown|document|ebook|book)$/i.test(title);
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}
