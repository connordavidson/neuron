import type { Chapter } from '../types';

export const CHAPTER_VERSION = 3;
export type OutlineItem = { title: string; pageIndex: number; level?: number };
export type SourceChapter = Omit<Chapter, 'paragraphIndex'> & { pageIndex: number; lineIndex: number; endLineIndex: number };
export type BookStructureOptions = {
  outlines?: OutlineItem[];
  paragraphPages?: number[];
  chapterMarkers?: Chapter[];
  sourcePages?: string[];
  pageLineFonts?: number[][];
  sourceChapters?: SourceChapter[];
};
export type BookStructure = { chapters: Chapter[]; readingStart: number };
const FRONT = /^(?:cover|title page|copyright|dedication|contents|table of contents|also (?:by|from)|acknowledg(?:e)?ments?|with appreciation)\b/i;
const BACK = /^(?:appendix|glossary|notes|endnotes|references|bibliography|index|illustration credits|about the author|abbreviations in)\b/i;
const SPECIAL = /^(?:introduction|prologue|epilogue|preface|foreword|afterword|conclusion)$/i;
const NUMBER = '(?:\\d{1,3}|[IVXLCDM]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
const EXPLICIT = new RegExp('^(chapter|habit|part|book)\\s+(' + NUMBER + ')(?:\\s*[:.\\-–—]\\s*(.*))?$', 'i');
const WORD_CHAPTER = new RegExp('^(' + NUMBER + ')\\s*[:.]\\s+\\p{L}', 'iu');

function clean(text: string): string {
  return text.replace(/\u0008|\uFFFD+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/C\s+H\s+A\s+P\s+T\s+E\s+R/gi, 'CHAPTER')
    .replace(/P\s+A\s+R\s+T/gi, 'PART')
    .replace(/^(CHAPTER\s+)(\d)\s+(\d)\b/i, '$1$2$3');
}
export function headingKey(text: string): string {
  return clean(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function kind(title: string): Chapter['kind'] {
  return FRONT.test(title) ? 'frontMatter' : BACK.test(title) ? 'backMatter'
    : /^(part|book)\s/i.test(title) ? 'part' : 'chapter';
}
function linesOf(page: string): Array<{ text: string; index: number }> {
  return page.split('\n').map((text, index) => ({ text: clean(text), index })).filter(({ text }) => text.length > 0);
}
function isTitle(text: string): boolean {
  if (text.length < 2 || text.length > 150 || /^\d+$/.test(text)) return false;
  const words = text.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  if (!words.length || words.length > 20) return false;
  return words.filter((word) => /^[^\p{L}]*\p{Lu}/u.test(word)).length / words.length >= 0.55;
}
function tocPages(pages: string[]): Set<number> {
  const result = new Set<number>();
  pages.forEach((page, index) => {
    const lines = linesOf(page);
    const label = lines.slice(0, 4).some(({ text }) => /^(table of )?contents$/i.test(text));
    const leaders = page.split('\n').filter((line) => /[.\uFFFD·]{3,}\s*\d{1,4}[.]?\s*$/.test(line)).length;
    const pageNumbers = lines.filter(({ text }) => /^\d{1,4}$/.test(text)).length;
    const partLabels = lines.filter(({ text }) => /^part\s+[IVX\d]+\b/i.test(text)).length;
    if (label || leaders >= 4 || (pageNumbers >= 6 && partLabels >= 2)) result.add(index);
  });
  return result;
}
function titleAt(pages: string[], pageIndex: number, title: string): { lineIndex: number; endLineIndex: number } {
  const lines = linesOf(pages[pageIndex] ?? '');
  const key = headingKey(title);
  const bare = key.replace(/^(chapter|habit|part|book)\s+\S+\s*/, '').replace(new RegExp('^' + NUMBER + '\\s+', 'i'), '');
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    for (let span = 1; span <= 5 && i + span <= lines.length; span++) {
      const candidate = headingKey(lines.slice(i, i + span).map((line) => line.text).join(' '));
      if (candidate === key || (bare.length >= 8 && candidate === bare)) {
        return { lineIndex: lines[i]!.index, endLineIndex: lines[i + span - 1]!.index + 1 };
      }
    }
  }
  return { lineIndex: 0, endLineIndex: 0 };
}

function explicitHeadings(pages: string[], tables: Set<number>, fonts: number[][]): SourceChapter[] {
  const found: SourceChapter[] = [];
  pages.forEach((page, pageIndex) => {
    if (tables.has(pageIndex)) return;
    const lines = linesOf(page);
    for (let i = 0; i < Math.min(8, lines.length); i++) {
      const line = lines[i]!;
      const match = line.text.match(EXPLICIT);
      const special = SPECIAL.test(line.text);
      if (!match && !special) continue;
      if (match?.[3] && /[.!?]$/.test(match[3])) continue;
      if (lines.slice(0, i).some(({ text }) => text.length > 100 || /[.!?]["”']?$/.test(text))) continue;
      let title = line.text;
      let end = line.index + 1;
      if (match && !match[3]) {
        const first = lines[i + 1];
        if (first && isTitle(first.text) && !EXPLICIT.test(first.text)) {
          const headingSize = fonts[pageIndex]?.[first.index] ?? 0;
          const pieces: string[] = [];
          for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            const next = lines[j]!;
            const size = fonts[pageIndex]?.[next.index] ?? 0;
            if (!isTitle(next.text) || EXPLICIT.test(next.text) || SPECIAL.test(next.text)) break;
            if (pieces.length && headingSize && size && Math.abs(size - headingSize) > 0.75) break;
            if (pieces.length && !headingSize && pieces.join(' ').length + next.text.length > 110) break;
            pieces.push(next.text);
            end = next.index + 1;
          }
          title = title.replace(/[:.\s]+$/, '') + ': ' + pieces.join(' ');
        }
      }
      found.push({ pageIndex, title, lineIndex: line.index, endLineIndex: end, kind: kind(title), level: match?.[1]?.toLowerCase() === 'part' ? 0 : 1 });
    }
  });
  const seen = new Set<string>();
  return found.filter((item) => {
    const key = headingKey(item.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tocHeadings(pages: string[], tables: Set<number>): SourceChapter[] {
  const result: SourceChapter[] = [];
  const tableIndices = [...tables].sort((a, b) => a - b);
  for (const table of tableIndices) {
    const end = tableIndices.find((index) => index > table + 1) ?? pages.length;
    let pending = '';
    const entries: Array<{ title: string; alternative: string; printed: number }> = [];
    for (const raw of (pages[table] ?? '').split('\n')) {
      if (/^(table of )?contents$/i.test(clean(raw))) continue;
      const match = raw.match(/^(.*?)\s*[\u0008\uFFFD.·][\u0008\uFFFD.·\s]+(\d{1,4})[.]?\s*$/);
      if (match) {
        entries.push({ title: clean(match[1]!), alternative: clean(pending + ' ' + match[1]), printed: Number(match[2]) });
        pending = '';
      } else if (clean(raw).length > 4 && isTitle(clean(raw))) {
        pending = pending ? pending + ' ' + clean(raw) : clean(raw);
        if (pending.length > 180) pending = '';
      }
    }
    // Calibrate printed page numbers separately for each volume/contents table.
    // Require agreement from multiple headings before using an offset.
    const matches: Array<{ entry: typeof entries[number]; chapter: SourceChapter }> = [];
    for (const entry of entries) {
      if (!entry.title || entry.title.length > 220) continue;
      const keys = [headingKey(entry.title), headingKey(entry.alternative)];
      for (let pageIndex = table + 1; pageIndex < end; pageIndex++) {
        if (tables.has(pageIndex)) continue;
        const lines = linesOf(pages[pageIndex] ?? '');
        let matched = false;
        for (let i = 0; i < Math.min(lines.length, 8) && !matched; i++) {
          for (let span = 1; span <= 4 && i + span <= lines.length; span++) {
            const candidate = headingKey(lines.slice(i, i + span).map((line) => line.text).join(' '));
            if (!keys.includes(candidate)) continue;
            const title = candidate === keys[1] ? entry.alternative : entry.title;
            matches.push({ entry, chapter: { title, pageIndex, lineIndex: lines[i]!.index,
              endLineIndex: lines[i + span - 1]!.index + 1, kind: kind(title), level: 1 } });
            matched = true;
            break;
          }
        }
      }
    }
    const votes = new Map<number, number>();
    for (const { entry, chapter } of matches) {
      const offset = chapter.pageIndex - entry.printed;
      votes.set(offset, (votes.get(offset) ?? 0) + 1);
    }
    const best = [...votes].sort((a, b) => b[1] - a[1])[0];
    for (const entry of entries) {
      const exact = matches.find((match) => match.entry === entry && (!best || best[1] < 2 || match.chapter.pageIndex === entry.printed + best[0]));
      if (exact) { result.push(exact.chapter); continue; }
      if (!best || best[1] < 2) continue;
      const pageIndex = entry.printed + best[0];
      if (pageIndex <= table || pageIndex >= end) continue;
      const prefix = headingKey(entry.title).replace(/\s+\d.*$/, '').replace(/^uk$/, 'united kingdom');
      const top = headingKey(linesOf(pages[pageIndex] ?? '').slice(0, 4).map((line) => line.text).join(' '));
      if (prefix.length >= 2 && top.startsWith(prefix + ' ')) {
        result.push({ title: entry.title, pageIndex, lineIndex: 0, endLineIndex: 0, kind: kind(entry.title), level: 1 });
      }
    }
  }
  return result;
}

export function detectSourceChapters(pages: string[], outlines: OutlineItem[] = [], pageLineFonts: number[][] = []): SourceChapter[] {
  const tables = tocPages(pages);
  const explicit = explicitHeadings(pages, tables, pageLineFonts);
  const usable = outlines.filter((item) => item.pageIndex >= 0 && item.pageIndex < pages.length
    && clean(item.title).length > 0 && clean(item.title).length <= 400);
  const labelCounts = new Map<string, number>();
  usable.forEach(({ title }) => labelCounts.set(headingKey(title), (labelCounts.get(headingKey(title)) ?? 0) + 1));
  const meaningful = usable.filter((item) => !(item.pageIndex <= 1 && (labelCounts.get(headingKey(item.title)) ?? 0) > 1));
  const numbered = meaningful.filter((item) => EXPLICIT.test(clean(item.title)) || WORD_CHAPTER.test(clean(item.title)));
  const hasChapterSeries = numbered.filter(({ title }) => !/^(part|book)\b/i.test(title)).length >= 2;
  const body = meaningful.filter(({ title }) => !FRONT.test(title) && !BACK.test(title));
  const depth = Math.min(...body.map((item) => item.level ?? 0));
  const selected = meaningful.filter((item) => {
    const title = clean(item.title);
    if (FRONT.test(title) || BACK.test(title) || SPECIAL.test(title)) return true;
    if (hasChapterSeries) return numbered.includes(item);
    return (item.level ?? 0) === depth || (item.level ?? 0) === depth + 1 && body.some((parent) =>
      /^(part|book)\b/i.test(parent.title) && parent.pageIndex === item.pageIndex);
  });
  const bookmarked = selected.map((item): SourceChapter => ({
    ...item, title: clean(item.title), kind: kind(clean(item.title)), ...titleAt(pages, item.pageIndex, item.title),
  }));
  const families = new Set(numbered.map(({ title }) => clean(title).match(EXPLICIT)?.[1]?.toLowerCase()).filter(Boolean));
  const supplements = hasChapterSeries ? explicit.filter((item) => {
    const family = item.title.match(EXPLICIT)?.[1]?.toLowerCase();
    return family && families.has(family);
  }) : explicit;
  const candidates = [...bookmarked, ...supplements, ...(hasChapterSeries ? [] : tocHeadings(pages, tables))];
  const byKey = new Map<string, SourceChapter>();
  for (const item of candidates) {
    const numberedTitle = item.title.match(EXPLICIT);
    const identity = item.pageIndex + ':' + (numberedTitle ? headingKey(numberedTitle[1] + ' ' + numberedTitle[2]) : headingKey(item.title));
    const previous = byKey.get(identity);
    if (!previous || item.title.length > previous.title.length) byKey.set(identity, item);
  }
  const sorted = [...byKey.values()].sort((a, b) => a.pageIndex - b.pageIndex || a.lineIndex - b.lineIndex);
  return sorted.filter((item, index) => !sorted.slice(0, index).some((previous) => {
    if (previous.pageIndex !== item.pageIndex || previous.kind === 'part' || item.kind === 'part') return false;
    const a = headingKey(previous.title), b = headingKey(item.title);
    return a === b || a.startsWith(b + ' ') || b.startsWith(a + ' ');
  }));
}

export function detectBookStructure(paragraphs: string[], options: BookStructureOptions = {}): BookStructure {
  const source = options.sourceChapters ?? detectSourceChapters(options.sourcePages ?? [], options.outlines, options.pageLineFonts);
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
