import type { PDFExtractionResult, PDFPageExtraction, PDFTextSpan } from '../../../modules/pdf-text-extractor/src/PDFTextExtractor.types';
import { positive, unionRects, cleanLine, joinSpans, uniqueBy, furnitureKey, unique, groupBy, isPageNumberLine, looksTabular, joinPDFLines } from './utils';
import type { LayoutLine, InternalBlock } from './types';
import { TERMINAL_PROSE, CHAPTER_PATTERN, PART_PATTERN, classifySectionTitle } from './policy';
import type { ContentBlockKind } from '../../types';
import { makeSourceAnchor } from '../readingUnits';

export function normalizedPages(extraction: PDFExtractionResult): PDFPageExtraction[] {
  if (extraction.structuredPages?.length) {
    return extraction.structuredPages.map((page, index) => ({
      ...page,
      index,
      text: page.text ?? extraction.pages[index] ?? '',
      width: positive(page.width, 612),
      height: positive(page.height, 792),
      rotation: page.rotation ?? 0,
      spans: Array.isArray(page.spans) ? page.spans : [],
      links: Array.isArray(page.links) ? page.links : [],
    }));
  }
  return extraction.pages.map((text, index) => ({
    index,
    text,
    width: 612,
    height: 792,
    rotation: 0,
    spans: fallbackSpans(text),
    links: [],
  }));
}

export function fallbackSpans(text: string): PDFTextSpan[] {
  let cursor = 0;
  return text.split(/\r?\n/u).map((line, lineIndex) => {
    const start = cursor;
    cursor += line.length + 1;
    return {
      text: line,
      sourceStart: start,
      sourceEnd: start + line.length,
      lineIndex,
      bounds: { x: 54, y: 64 + lineIndex * 16, width: Math.min(504, line.length * 7), height: 14 },
      fontName: '',
      fontSize: 11,
      bold: false,
      italic: false,
    };
  });
}

export function linesFromPage(page: PDFPageExtraction): LayoutLine[] {
  const grouped = new Map<number, PDFTextSpan[]>();
  for (const span of page.spans) {
    if (!span.text.trim()) continue;
    if (span.bounds.x + span.bounds.width <= 0 || span.bounds.x >= page.width
      || span.bounds.y + span.bounds.height <= 0 || span.bounds.y >= page.height) continue;
    const lineIndex = Number.isFinite(span.lineIndex) ? span.lineIndex : Math.round(span.bounds.y / Math.max(1, span.bounds.height));
    grouped.set(lineIndex, [...(grouped.get(lineIndex) ?? []), span]);
  }
  if (!grouped.size && page.text) {
    for (const span of fallbackSpans(page.text)) grouped.set(span.lineIndex, [span]);
  }
  // Extractors may give both columns the same baseline/line index. Split at
  // physical gutters before joining font runs, never after flattening the text.
  const gutterGaps: Array<{ left: number; right: number; row: number }> = [];
  for (const [row, spans] of grouped) {
    const ordered = [...spans].sort((a, b) => a.bounds.x - b.bounds.x);
    for (let index = 1; index < ordered.length; index++) {
      const left = ordered[index - 1]!.bounds.x + ordered[index - 1]!.bounds.width;
      const right = ordered[index]!.bounds.x;
      if (right - left >= 8 && left > page.width * 0.25 && right < page.width * 0.75) gutterGaps.push({ left, right, row });
    }
  }
  const rows = [...grouped.entries()].flatMap(([lineIndex, spans]) => {
    const ordered = [...spans].sort((a, b) => a.bounds.x - b.bounds.x || a.sourceStart - b.sourceStart);
    const pieces: PDFTextSpan[][] = [];
    for (const span of ordered) {
      const previous = pieces.at(-1)?.at(-1);
      const left = previous ? previous.bounds.x + previous.bounds.width : span.bounds.x;
      const gap = span.bounds.x - left;
      const narrowGutter = gap >= 8 && new Set(gutterGaps.filter((candidate) =>
        Math.min(candidate.right, span.bounds.x) - Math.max(candidate.left, left) >= 6).map(({ row }) => row)).size >= Math.max(3, grouped.size * 0.4);
      if (!previous || gap > Math.max(18, Math.min(previous.fontSize, span.fontSize) * 1.6) || narrowGutter) pieces.push([]);
      pieces.at(-1)!.push(span);
    }
    return pieces.map((ordered, piece) => ({ lineIndex, ordered, piece }));
  });
  const lines = rows.map(({ lineIndex, ordered, piece }) => {
    const bounds = unionRects(ordered.map(({ bounds }) => bounds));
    const largest = ordered.reduce((best, span) => span.text.length > best.text.length ? span : best, ordered[0]!);
    const text = cleanLine(joinSpans(ordered));
    return {
      id: `${page.index}:${lineIndex}:${piece}`,
      pageIndex: page.index,
      pageLabel: page.label,
      lineIndex,
      text,
      sourceStart: Math.min(...ordered.map(({ sourceStart }) => sourceStart)),
      sourceEnd: Math.max(...ordered.map(({ sourceEnd }) => sourceEnd)),
      bounds,
      pageWidth: page.width,
      pageHeight: page.height,
      fontName: largest.fontName,
      fontSize: largest.fontSize,
      bold: ordered.filter(({ bold }) => bold).reduce((sum, span) => sum + span.text.length, 0) >= ordered.reduce((sum, span) => sum + span.text.length, 0) * 0.7,
      italic: ordered.some(({ italic }) => italic),
      centered: Math.abs(bounds.x + bounds.width / 2 - page.width / 2) <= page.width * 0.08,
    };
  }).filter(({ text }) => text.length > 0);
  return orderPageLines(lines);
}

export function orderPageLines(lines: LayoutLine[]): LayoutLine[] {
  if (lines.length < 8 || !lines.some(({ bounds }) => bounds.width > 0)) {
    return [...lines].sort((a, b) => a.lineIndex - b.lineIndex);
  }
  const pageWidth = lines[0]?.pageWidth ?? 612;
  let split = 0;
  let bestScore = 0;
  // Look for a persistent empty gutter, not a gap between line centers:
  // short lines, equations and glossary labels make center clustering unstable.
  for (let x = pageWidth * 0.28; x <= pageWidth * 0.72; x += 2) {
    const left = lines.filter((line) => line.bounds.x + line.bounds.width <= x - 3);
    const right = lines.filter((line) => line.bounds.x >= x + 3);
    const crossing = lines.length - left.length - right.length;
    if (Math.min(left.length, right.length) < Math.max(3, lines.length * 0.18) || crossing > Math.max(2, lines.length * 0.2)) continue;
    const alignedRows = left.filter((line) => right.some((other) => Math.abs(other.bounds.y - line.bounds.y) < Math.max(line.fontSize, other.fontSize))).length;
    if (alignedRows < 3) continue;
    const score = left.length + right.length - crossing * 4 - Math.abs(x - pageWidth / 2) / pageWidth;
    if (score > bestScore) { split = x; bestScore = score; }
  }
  if (!split) {
    return [...lines].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x || a.lineIndex - b.lineIndex);
  }
  const fullWidth = lines.filter((line) => line.bounds.x < split && line.bounds.x + line.bounds.width > split);
  const columnLines = lines.filter((line) => !fullWidth.includes(line));
  const ordered: LayoutLine[] = [];
  let top = -Infinity;
  for (const divider of [...fullWidth].sort((a, b) => a.bounds.y - b.bounds.y)) {
    ordered.push(...orderColumns(columnLines.filter((line) => line.bounds.y >= top && line.bounds.y < divider.bounds.y), split));
    ordered.push(divider);
    top = divider.bounds.y;
  }
  ordered.push(...orderColumns(columnLines.filter((line) => line.bounds.y >= top), split));
  return uniqueBy(ordered, ({ id }) => id);
}

export function orderColumns(lines: LayoutLine[], split: number): LayoutLine[] {
  const sorted = (items: LayoutLine[]) => [...items].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  return [...sorted(lines.filter((line) => line.bounds.x + line.bounds.width / 2 < split)),
    ...sorted(lines.filter((line) => line.bounds.x + line.bounds.width / 2 >= split))];
}

export function detectRunningFurniture(lines: LayoutLine[], pageCount: number): Set<string> {
  const clusters = new Map<string, LayoutLine[]>();
  for (const line of lines) {
    const relativeTop = line.bounds.y / Math.max(1, line.pageHeight);
    if (relativeTop > 0.14 && relativeTop < 0.86) continue;
    if (TERMINAL_PROSE.test(line.text) && line.text.split(/\s+/u).length > 8) continue;
    const normalized = furnitureKey(line.text);
    if (!normalized || normalized.length > 120) continue;
    const position = relativeTop <= 0.14 ? 'top' : 'bottom';
    const style = `${Math.round(line.fontSize * 2) / 2}:${line.bold ? 'b' : 'n'}`;
    const key = `${position}:${normalized}:${style}`;
    clusters.set(key, [...(clusters.get(key) ?? []), line]);
  }
  const removed = new Set<string>();
  const threshold = Math.max(3, Math.ceil(pageCount * 0.25));
  for (const group of clusters.values()) {
    const pages = unique(group.map(({ pageIndex }) => pageIndex)).sort((a, b) => a - b);
    const localDensity = pages.length / Math.max(1, pages.at(-1)! - pages[0]! + 1);
    const positions = group.map((line) => line.bounds.y / line.pageHeight);
    const stablePosition = Math.max(...positions) - Math.min(...positions) <= 0.025;
    if (pages.length < threshold && !(pages.length >= 3 && localDensity >= 0.3 && stablePosition)) continue;
    group.forEach(({ id }) => removed.add(id));
  }
  return removed;
}

export function reconstructBlocks(lines: LayoutLine[]): InternalBlock[] {
  const pageGroups = groupBy(lines.filter((line) => !(isPageNumberLine(line.text)
    && (line.bounds.y < line.pageHeight * 0.14 || line.bounds.y > line.pageHeight * 0.86))), ({ pageIndex }) => pageIndex);
  const sizeWeights = new Map<number, number>();
  for (const line of lines) {
    if (line.text.length < 40 || line.fontSize <= 0) continue;
    const size = Math.round(line.fontSize * 4) / 4;
    sizeWeights.set(size, (sizeWeights.get(size) ?? 0) + line.text.length);
  }
  // A long abstract or many small footnotes can dominate a single page. Use
  // the document's character-weighted body style, not that page's line median.
  const documentMedian = [...sizeWeights].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
  const result: InternalBlock[] = [];
  for (const [pageIndex, pageLines] of [...pageGroups.entries()].sort((a, b) => a[0] - b[0])) {
    const median = documentMedian;
    let current: LayoutLine[] = [];
    const flush = () => {
      if (!current.length) return;
      result.push(blockFromLines(current, median, result.length));
      current = [];
    };
    // Preserve punctuation runs that form an ellipsis with the following prose.
    // They are source text, not decorative separators, even on separate lines.
    const joinedLines: LayoutLine[] = [];
    for (let index = 0; index < pageLines.length; index++) {
      const first = pageLines[index]!;
      let end = index;
      while (end < pageLines.length - 1 && /^["'“‘]?\.{1,2}$/u.test(pageLines[end]!.text)) end++;
      const run = pageLines.slice(index, end + 1);
      if (end > index && /^(?:["'“‘]?\.\s*){3}/u.test(run.map(line => line.text).join(' '))) {
        const last = pageLines[end]!;
        joinedLines.push({ ...last, id: first.id, sourceStart: first.sourceStart,
          text: run.map(line => line.text).join(' '), bounds: unionRects(run.map(line => line.bounds)) });
        index = end;
      } else joinedLines.push(first);
    }
    for (const line of joinedLines) {
      const lineKind = classifyLine(line, median);
      const previous = current.at(-1);
      if (!previous || canJoinLines(previous, line, lineKind, classifyLine(previous, median))) {
        current.push(line);
      } else {
        flush();
        current.push(line);
      }
      if (lineKind !== 'prose') flush();
    }
    flush();
    if (!pageLines.length && pageIndex === 0) continue;
  }
  return result;
}

export function classifyLine(line: LayoutLine, median: number): ContentBlockKind {
  const text = line.text;
  if (!/[\p{L}\p{N}]/u.test(text)) return 'decorative';
  if (/^(?:figure|fig\.?|table|chart|image|photo|source)\s*[\d.:\-–—]/iu.test(text)) return 'caption';
  if (looksTabular(text)) return 'table';
  if ((line.fontSize > 0 && line.fontSize <= median * 0.79 && line.bounds.y > line.pageHeight * 0.58)
    || /^\s*(?:\d{1,3}|[*†‡])\s+[\p{Lu}“"']/u.test(text) && line.fontSize < median) return 'footnote';
  if (looksLikeHeading(line, median)) return 'heading';
  return 'prose';
}

export function looksLikeHeading(line: LayoutLine, median: number): boolean {
  const text = line.text;
  if (text.length < 2 || text.length > 180 || /\.["'”’»）)\]}]*$/u.test(text) || /^https?:|^www\./iu.test(text)) return false;
  if ((CHAPTER_PATTERN.test(text) || PART_PATTERN.test(text)) && !/^\p{Ll}/u.test(text)) return true;
  if (classifySectionTitle(text) && /^\p{Lu}/u.test(text) && text.split(/\s+/u).length <= 8 && !TERMINAL_PROSE.test(text)) return true;
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length > 18) return false;
  const letters = [...text].filter((character) => /\p{L}/u.test(character));
  const uppercase = letters.length >= 3 && letters.filter((letter) => letter === letter.toLocaleUpperCase()).length / letters.length > 0.82;
  return line.fontSize >= median * 1.18 || line.bold && line.fontSize >= median * 0.98
    || uppercase && (line.centered || line.fontSize >= median);
}

export function canJoinLines(previous: LayoutLine, next: LayoutLine, nextKind: ContentBlockKind, previousKind: ContentBlockKind): boolean {
  if (nextKind !== 'prose' || previousKind !== 'prose' || previous.pageIndex !== next.pageIndex) return false;
  const sameColumn = Math.abs(previous.bounds.x - next.bounds.x) < Math.max(18, previous.pageWidth * 0.08);
  const verticalGap = next.bounds.y - (previous.bounds.y + previous.bounds.height);
  const ordinaryGap = verticalGap >= -Math.min(previous.bounds.height, next.bounds.height) * 0.4 && verticalGap < Math.max(previous.fontSize, next.fontSize) * 1.55;
  return sameColumn && ordinaryGap && Math.abs(previous.fontSize - next.fontSize) <= Math.max(1.25, previous.fontSize * 0.16);
}

export function blockFromLines(lines: LayoutLine[], median: number, index: number): InternalBlock {
  const first = lines[0]!;
  const last = lines.at(-1)!;
  const bounds = unionRects(lines.map(({ bounds }) => bounds));
  const largest = lines.reduce((best, line) => line.fontSize > best.fontSize ? line : best, first);
  const kind = lines.length === 1 ? classifyLine(first, median) : 'prose';
  const text = joinPDFLines(lines.map(({ text }) => text));
  const confidence = kind === 'heading' ? Math.min(0.98, 0.55 + (largest.bold ? 0.14 : 0)
    + (largest.fontSize >= median * 1.2 ? 0.2 : 0) + (largest.centered ? 0.08 : 0)) : 0.88;
  return {
    id: `block-${index}`,
    kind,
    text,
    anchor: makeSourceAnchor(first.pageIndex, first.pageLabel, first.sourceStart, last.sourceEnd, text),
    bounds,
    fontSize: largest.fontSize,
    fontName: largest.fontName,
    confidence,
    evidence: kind === 'heading'
      ? ['short non-sentence line', largest.bold ? 'bold typography' : '', largest.centered ? 'center alignment' : '', largest.fontSize >= median * 1.2 ? 'prominent font size' : ''].filter(Boolean)
      : [`layout classified as ${kind}`],
    pageHeight: first.pageHeight,
    pageWidth: first.pageWidth,
    centered: largest.centered,
    bold: largest.bold,
    italic: largest.italic,
  };
}
