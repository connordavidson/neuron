import type {
  PDFExtractionResult,
  PDFPageExtraction,
  PDFTextSpan,
} from '../../modules/pdf-text-extractor/src/PDFTextExtractor.types';
import type {
  BookMetadata,
  Chapter,
  ContentBlock,
  ContentBlockKind,
  ContextualSupplement,
  Evidence,
  ParseDiagnostics,
  ReadingUnit,
  SectionNode,
  SemanticSectionKind,
  SourceAnchor,
  SourceRect,
} from '../types';
import { sentenceSpans } from './sentences';

export const CONTENT_PARSER_VERSION = 6;

export type SentenceTokenizer = (texts: string[]) => Promise<number[][]>;

export type ParsedEbook = {
  metadata: BookMetadata;
  sections: SectionNode[];
  blocks: ContentBlock[];
  readingUnits: ReadingUnit[];
  supplements: ContextualSupplement[];
  diagnostics: ParseDiagnostics;
  chapters: Chapter[];
  paragraphs: string[];
  paragraphPages: number[];
  readingStart: number;
};

type LayoutLine = {
  id: string;
  pageIndex: number;
  pageLabel?: string;
  lineIndex: number;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  bounds: SourceRect;
  pageWidth: number;
  pageHeight: number;
  fontName: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  centered: boolean;
};

type InternalBlock = ContentBlock & {
  pageHeight: number;
  pageWidth: number;
  centered: boolean;
  bold: boolean;
  italic: boolean;
};

type SectionCandidate = Evidence & {
  title: string;
  kind: SemanticSectionKind;
  pageIndex: number;
  blockIndex: number;
  level: number;
  source: 'outline' | 'heading' | 'toc' | 'page';
};

type PassageSegment = {
  start: number;
  end: number;
  block: InternalBlock;
};

type Passage = {
  section: SectionNode;
  text: string;
  segments: PassageSegment[];
};

const NAVIGABLE_KINDS = new Set<SemanticSectionKind>([
  'foreword', 'preface', 'acknowledgments', 'introduction', 'part', 'chapter',
  'section', 'conclusion', 'epilogue', 'appendix', 'glossary', 'notes',
  'bibliography', 'index', 'aboutAuthor', 'colophon',
]);
const PRIMARY_KINDS = new Set<SemanticSectionKind>([
  'foreword', 'preface', 'acknowledgments', 'introduction', 'part', 'chapter',
  'section', 'conclusion', 'epilogue', 'appendix', 'glossary', 'aboutAuthor', 'body',
]);
const BODY_START_KINDS = new Set<SemanticSectionKind>([
  'foreword', 'preface', 'introduction', 'part', 'chapter', 'section', 'body',
]);
const BACK_KINDS = new Set<SemanticSectionKind>([
  'conclusion', 'epilogue', 'appendix', 'glossary', 'notes', 'bibliography',
  'index', 'aboutAuthor', 'colophon', 'unknownBack',
]);
const FRONT_KINDS = new Set<SemanticSectionKind>([
  'cover', 'titlePage', 'copyright', 'dedication', 'contents', 'unknownFront',
]);
const EXPLICIT_NUMBER = '(?:\\d{1,4}|[IVXLCDM]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
const CHAPTER_PATTERN = new RegExp(`^(?:chapter|ch\\.?|habit)\\s+${EXPLICIT_NUMBER}(?:\\s*[:.\\-–—]\\s*.+)?$`, 'iu');
const PART_PATTERN = new RegExp(`^(?:part|book)\\s+${EXPLICIT_NUMBER}(?:\\s*[:.\\-–—]\\s*.+)?$`, 'iu');
const NUMBERED_SECTION_PATTERN = new RegExp(`^${EXPLICIT_NUMBER}(?:\\.\\d+)*[.:]?\\s+\\p{Lu}`, 'u');
const TERMINAL_PROSE = /[.!?…]["'”’»）)\]}]*$/u;

export async function parseEbook(
  extraction: PDFExtractionResult,
  originalFileName: string,
  tokenize?: SentenceTokenizer,
): Promise<ParsedEbook> {
  const pages = normalizedPages(extraction);
  const lines = pages.flatMap(linesFromPage);
  const furniture = detectRunningFurniture(lines, pages.length);
  const bodyLines = lines.filter((line) => !furniture.has(line.id));
  const blocks = reconstructBlocks(bodyLines);
  const metadata = inferMetadata(extraction, originalFileName, blocks, pages);
  const { sections, suppressedNavigation } = detectSections(extraction, blocks, pages, metadata.title.value);
  assignSections(blocks, sections);
  const passages = buildPassages(blocks, sections);
  const proposals = await sentenceBoundaries(passages.map(({ text }) => text), tokenize);
  const readingUnits = buildReadingUnits(passages, proposals);
  const supplements = buildSupplements(blocks, sections, readingUnits);
  attachSupplements(readingUnits, supplements);
  finalizeSectionRanges(sections, blocks, readingUnits);
  const readingStart = determineReadingStart(sections, readingUnits);
  const chapters = sections
    .filter((section) => NAVIGABLE_KINDS.has(section.kind) && section.confidence >= 0.62 && section.startUnit >= 0)
    .map((section): Chapter => ({
      paragraphIndex: section.startUnit,
      title: section.title,
      pageIndex: section.startPage,
      level: section.level,
      kind: legacyChapterKind(section.kind),
      sectionId: section.id,
      confidence: section.confidence,
    }));
  const warnings: string[] = [];
  if (!extraction.structuredPages?.some((page) => page.spans?.length)) {
    warnings.push('This import used text-only extraction because structured PDF spans were unavailable.');
  }
  if (!chapters.some((chapter) => chapter.kind === 'chapter')) {
    warnings.push('No chapter candidate met the navigation confidence threshold.');
  }
  if (!readingUnits.length) warnings.push('No primary prose reading units were produced.');
  const diagnostics: ParseDiagnostics = {
    parserVersion: CONTENT_PARSER_VERSION,
    warnings,
    suppressedNavigation,
    counts: {
      sourcePages: pages.length,
      sourceSpans: pages.reduce((sum, page) => sum + page.spans.length, 0),
      blocks: blocks.length,
      readingUnits: readingUnits.length,
      supplements: supplements.length,
      sections: sections.length,
      removedFurniture: furniture.size,
    },
  };
  return {
    metadata,
    sections,
    blocks: blocks.map(stripInternalBlock),
    readingUnits,
    supplements,
    diagnostics,
    chapters,
    paragraphs: readingUnits.map(({ text }) => text),
    paragraphPages: readingUnits.map(({ anchor }) => anchor.pageIndex),
    readingStart,
  };
}

function normalizedPages(extraction: PDFExtractionResult): PDFPageExtraction[] {
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

function fallbackSpans(text: string): PDFTextSpan[] {
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

function linesFromPage(page: PDFPageExtraction): LayoutLine[] {
  const grouped = new Map<number, PDFTextSpan[]>();
  for (const span of page.spans) {
    if (!span.text.trim()) continue;
    const lineIndex = Number.isFinite(span.lineIndex) ? span.lineIndex : Math.round(span.bounds.y / Math.max(1, span.bounds.height));
    grouped.set(lineIndex, [...(grouped.get(lineIndex) ?? []), span]);
  }
  if (!grouped.size && page.text) {
    for (const span of fallbackSpans(page.text)) grouped.set(span.lineIndex, [span]);
  }
  const lines = [...grouped.entries()].map(([lineIndex, spans]) => {
    const ordered = [...spans].sort((a, b) => a.bounds.x - b.bounds.x || a.sourceStart - b.sourceStart);
    const bounds = unionRects(ordered.map(({ bounds }) => bounds));
    const largest = ordered.reduce((best, span) => span.fontSize > best.fontSize ? span : best, ordered[0]!);
    const text = cleanLine(joinSpans(ordered));
    return {
      id: `${page.index}:${lineIndex}`,
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
      bold: ordered.some(({ bold }) => bold),
      italic: ordered.some(({ italic }) => italic),
      centered: Math.abs(bounds.x + bounds.width / 2 - page.width / 2) <= page.width * 0.08,
    };
  }).filter(({ text }) => text.length > 0);
  return orderPageLines(lines);
}

function orderPageLines(lines: LayoutLine[]): LayoutLine[] {
  if (lines.length < 8 || !lines.some(({ bounds }) => bounds.width > 0)) {
    return [...lines].sort((a, b) => a.lineIndex - b.lineIndex);
  }
  const pageWidth = lines[0]?.pageWidth ?? 612;
  const eligible = lines.filter((line) => line.bounds.width < pageWidth * 0.72);
  const centers = eligible.map((line) => line.bounds.x + line.bounds.width / 2).sort((a, b) => a - b);
  let split = 0;
  let largestGap = 0;
  for (let index = 1; index < centers.length; index++) {
    const gap = centers[index]! - centers[index - 1]!;
    if (gap > largestGap) { largestGap = gap; split = (centers[index]! + centers[index - 1]!) / 2; }
  }
  const leftCount = eligible.filter((line) => line.bounds.x + line.bounds.width / 2 < split).length;
  const rightCount = eligible.length - leftCount;
  if (largestGap < pageWidth * 0.16 || leftCount < 3 || rightCount < 3) {
    return [...lines].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x || a.lineIndex - b.lineIndex);
  }
  const fullWidth = lines.filter((line) => line.bounds.width >= pageWidth * 0.72);
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

function orderColumns(lines: LayoutLine[], split: number): LayoutLine[] {
  const sorted = (items: LayoutLine[]) => [...items].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  return [...sorted(lines.filter((line) => line.bounds.x + line.bounds.width / 2 < split)),
    ...sorted(lines.filter((line) => line.bounds.x + line.bounds.width / 2 >= split))];
}

function detectRunningFurniture(lines: LayoutLine[], pageCount: number): Set<string> {
  const clusters = new Map<string, LayoutLine[]>();
  for (const line of lines) {
    const relativeTop = line.bounds.y / Math.max(1, line.pageHeight);
    if (relativeTop > 0.14 && relativeTop < 0.86) continue;
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
    if (new Set(group.map(({ pageIndex }) => pageIndex)).size < threshold) continue;
    group.forEach(({ id }) => removed.add(id));
  }
  return removed;
}

function reconstructBlocks(lines: LayoutLine[]): InternalBlock[] {
  const pageGroups = groupBy(lines.filter((line) => !isPageNumberLine(line.text)), ({ pageIndex }) => pageIndex);
  const result: InternalBlock[] = [];
  for (const [pageIndex, pageLines] of [...pageGroups.entries()].sort((a, b) => a[0] - b[0])) {
    const bodySizes = pageLines.map(({ fontSize }) => fontSize).filter((size) => size > 0).sort((a, b) => a - b);
    const median = bodySizes[Math.floor(bodySizes.length / 2)] ?? 11;
    let current: LayoutLine[] = [];
    const flush = () => {
      if (!current.length) return;
      result.push(blockFromLines(current, median, result.length));
      current = [];
    };
    for (const line of pageLines) {
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

function classifyLine(line: LayoutLine, median: number): ContentBlockKind {
  const text = line.text;
  if (!/[\p{L}\p{N}]/u.test(text)) return 'decorative';
  if (/^(?:figure|fig\.?|table|chart|image|photo|source)\s*[\d.:\-–—]/iu.test(text)) return 'caption';
  if (looksTabular(text)) return 'table';
  if ((line.fontSize > 0 && line.fontSize <= median * 0.79 && line.bounds.y > line.pageHeight * 0.58)
    || /^\s*(?:\d{1,3}|[*†‡])\s+[\p{Lu}“"']/u.test(text) && line.fontSize < median) return 'footnote';
  if (looksLikeHeading(line, median)) return 'heading';
  return 'prose';
}

function looksLikeHeading(line: LayoutLine, median: number): boolean {
  const text = line.text;
  if (text.length < 2 || text.length > 180 || TERMINAL_PROSE.test(text) || /^https?:|^www\./iu.test(text)) return false;
  if (classifySectionTitle(text) || CHAPTER_PATTERN.test(text) || PART_PATTERN.test(text)) return true;
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length > 18) return false;
  const letters = [...text].filter((character) => /\p{L}/u.test(character));
  const uppercase = letters.length >= 3 && letters.filter((letter) => letter === letter.toLocaleUpperCase()).length / letters.length > 0.82;
  return line.fontSize >= median * 1.18 || line.bold && line.fontSize >= median * 0.98
    || uppercase && (line.centered || line.fontSize >= median);
}

function canJoinLines(previous: LayoutLine, next: LayoutLine, nextKind: ContentBlockKind, previousKind: ContentBlockKind): boolean {
  if (nextKind !== 'prose' || previousKind !== 'prose' || previous.pageIndex !== next.pageIndex) return false;
  const sameColumn = Math.abs(previous.bounds.x - next.bounds.x) < Math.max(18, previous.pageWidth * 0.08);
  const verticalGap = next.bounds.y - (previous.bounds.y + previous.bounds.height);
  const ordinaryGap = !Number.isFinite(verticalGap) || verticalGap < Math.max(previous.fontSize, next.fontSize) * 1.55;
  return sameColumn && ordinaryGap && Math.abs(previous.fontSize - next.fontSize) <= Math.max(1.25, previous.fontSize * 0.16);
}

function blockFromLines(lines: LayoutLine[], median: number, index: number): InternalBlock {
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
    anchor: makeAnchor(first.pageIndex, first.pageLabel, first.sourceStart, last.sourceEnd, text),
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

function inferMetadata(
  extraction: PDFExtractionResult,
  originalFileName: string,
  blocks: InternalBlock[],
  pages: PDFPageExtraction[],
): BookMetadata {
  const fallback = stripExtension(originalFileName).trim() || 'Untitled book';
  const rawMetadataTitle = cleanLine(extraction.metadata?.title ?? extraction.title ?? '');
  const opening = blocks.filter(({ anchor }) => anchor.pageIndex < Math.min(6, pages.length));
  const candidates = opening.filter((block) => block.kind === 'heading' && isPlausibleTitle(block.text))
    .map((block) => ({
      block,
      score: Math.min(0.96, 0.45 + Math.min(0.3, (block.fontSize ?? 0) / 80)
        + (block.centered ? 0.12 : 0) + (block.anchor.pageIndex <= 2 ? 0.1 : 0)),
    })).sort((a, b) => b.score - a.score);
  const pageTitle = candidates[0];
  const metadataUsable = isPlausibleTitle(rawMetadataTitle) && normalizeKey(rawMetadataTitle) !== normalizeKey(fallback);
  const corroborated = pageTitle && titleSimilarity(rawMetadataTitle, pageTitle.block.text) >= 0.7;
  const title = metadataUsable && (corroborated || !pageTitle)
    ? { value: rawMetadataTitle, confidence: corroborated ? 0.98 : 0.82,
      evidence: corroborated ? ['PDF metadata title', 'matching prominent title-page typography'] : ['PDF metadata title'] }
    : pageTitle
      ? { value: pageTitle.block.text, confidence: pageTitle.score, evidence: ['prominent opening-page typography'] }
      : { value: fallback, confidence: 0.45, evidence: ['normalized PDF filename fallback'] };
  const titleIndex = pageTitle ? opening.indexOf(pageTitle.block) : -1;
  const afterTitle = titleIndex >= 0 ? opening.slice(titleIndex + 1, titleIndex + 4) : opening.slice(0, 5);
  const subtitleBlock = afterTitle.find((block) => block.kind === 'heading' && block.text !== title.value
    && isPlausibleTitle(block.text) && !/^by\b/iu.test(block.text));
  const authorValues = [extraction.metadata?.author ?? '', ...opening
    .filter((block) => /^(?:by|edited by|written by)\s+/iu.test(block.text))
    .map((block) => block.text.replace(/^(?:by|edited by|written by)\s+/iu, ''))]
    .map(cleanLine).filter(Boolean);
  const authors = unique(authorValues).map((value, index) => ({
    value,
    confidence: index === 0 && extraction.metadata?.author ? 0.86 : 0.76,
    evidence: [index === 0 && extraction.metadata?.author ? 'PDF author metadata' : 'opening-page byline'],
  }));
  const publisherText = opening.map(({ text }) => text).find((text) => /(?:published by|university press|publishing|publishers?)\b/iu.test(text));
  const identifiers = unique(opening.flatMap(({ text }) => {
    const values: Array<{ value: string; scheme: 'doi' | 'isbn' | 'other' }> = [];
    for (const match of text.matchAll(/\b(?:ISBN(?:-1[03])?\s*:?[\s-]*)?((?:97[89][\s-]?)?[\dX][\dX\s-]{8,20}[\dX])\b/giu)) {
      values.push({ value: match[1]!.replace(/[\s-]+/g, ''), scheme: 'isbn' });
    }
    for (const match of text.matchAll(/\b(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)?(10\.\d{4,9}\/[\w.()/:;-]+)\b/giu)) {
      values.push({ value: match[1]!.replace(/[.,;]+$/, ''), scheme: 'doi' });
    }
    return values;
  }).map((item) => JSON.stringify(item))).map((item) => {
    const value = JSON.parse(item) as { value: string; scheme: 'doi' | 'isbn' | 'other' };
    return { ...value, confidence: 0.94, evidence: [`${value.scheme.toUpperCase()} pattern in front matter`] };
  });
  return {
    title,
    subtitle: subtitleBlock ? { value: subtitleBlock.text, confidence: 0.72, evidence: ['secondary title-page typography'] } : undefined,
    authors,
    publisher: publisherText ? { value: publisherText.replace(/^published by\s*/iu, ''), confidence: 0.74, evidence: ['publisher phrase in front matter'] } : undefined,
    language: { value: 'en', confidence: 0.7, evidence: ['English-first parser configuration'] },
    identifiers,
  };
}

function detectSections(
  extraction: PDFExtractionResult,
  blocks: InternalBlock[],
  pages: PDFPageExtraction[],
  bookTitle: string,
): { sections: SectionNode[]; suppressedNavigation: ParseDiagnostics['suppressedNavigation'] } {
  const candidates: SectionCandidate[] = [];
  const outlineItems = extraction.outlines ?? [];
  const tocEntries = parseTOCEntries(blocks);
  const tocPages = new Set(blocks.filter(({ text }) => /^(?:table of )?contents$/iu.test(text))
    .flatMap(({ anchor }) => [anchor.pageIndex, anchor.pageIndex + 1]));
  const headingBlocks = blocks.map((block, blockIndex) => ({ block, blockIndex }))
    .filter(({ block }) => block.kind === 'heading' && !tocPages.has(block.anchor.pageIndex));

  for (const { block, blockIndex } of headingBlocks) {
    const semantic = classifySectionTitle(block.text);
    const outline = outlineItems.find((item) => item.pageIndex === block.anchor.pageIndex
      && titleSimilarity(item.title, block.text) >= 0.72);
    const toc = tocEntries.find((item) => titleSimilarity(item.title, block.text) >= 0.78
      && (item.pageIndex == null || Math.abs(item.pageIndex - block.anchor.pageIndex) <= 1));
    let kind = semantic?.kind;
    if (!kind && CHAPTER_PATTERN.test(block.text)) kind = 'chapter';
    if (!kind && PART_PATTERN.test(block.text)) kind = 'part';
    if (!kind && NUMBERED_SECTION_PATTERN.test(block.text)) kind = 'section';
    if (!kind && !outline && !toc) continue;
    const displayedTitle = kind ? expandedHeadingTitle(blocks, blockIndex, kind) : cleanHeading(block.text);
    const explicit = Boolean(semantic || CHAPTER_PATTERN.test(block.text) || PART_PATTERN.test(block.text));
    let confidence = 0.2 + (explicit ? 0.34 : 0) + Math.max(0, block.confidence - 0.55) * 0.55;
    const evidence = [...block.evidence];
    if (outline) { confidence += 0.32; evidence.push('matching PDF outline destination'); }
    if (toc) { confidence += 0.2; evidence.push('matching spatial table-of-contents entry'); }
    if (block.bounds && block.bounds.y <= block.pageHeight * 0.28) { confidence += 0.08; evidence.push('near page top'); }
    if (TERMINAL_PROSE.test(block.text)) confidence -= 0.35;
    candidates.push({
      title: displayedTitle,
      kind: kind ?? 'section',
      pageIndex: block.anchor.pageIndex,
      blockIndex,
      level: semantic?.level ?? outline?.level ?? ((kind ?? 'section') === 'part' ? 0 : (kind ?? 'section') === 'section' ? 2 : 1),
      confidence: clamp01(confidence),
      evidence,
      source: outline ? 'outline' : toc ? 'toc' : 'heading',
    });
  }

  for (const item of outlineItems) {
    if (item.pageIndex < 0 || item.pageIndex >= pages.length || !cleanLine(item.title)) continue;
    if (candidates.some((candidate) => candidate.pageIndex === item.pageIndex && titleSimilarity(candidate.title, item.title) >= 0.7)) continue;
    const semantic = classifySectionTitle(item.title);
    const explicit = semantic || CHAPTER_PATTERN.test(item.title) || PART_PATTERN.test(item.title);
    const blockIndex = firstBlockOnOrAfterPage(blocks, item.pageIndex);
    const confidence = explicit ? 0.78 : 0.56;
    candidates.push({
      title: cleanHeading(item.title),
      kind: semantic?.kind ?? (PART_PATTERN.test(item.title) ? 'part' : CHAPTER_PATTERN.test(item.title) ? 'chapter' : 'section'),
      pageIndex: item.pageIndex,
      blockIndex,
      level: semantic?.level ?? item.level ?? 1,
      confidence,
      evidence: ['PDF outline destination', explicit ? 'recognized semantic label' : 'unconfirmed outline label'],
      source: 'outline',
    });
  }

  const pageKinds = detectPageSections(blocks, pages, bookTitle);
  for (const candidate of pageKinds) {
    if (!candidates.some((existing) => existing.pageIndex === candidate.pageIndex && existing.kind === candidate.kind)) {
      candidates.push(candidate);
    }
  }
  const firstConfirmedBodyPage = candidates
    .filter((candidate) => BODY_START_KINDS.has(candidate.kind) && candidate.confidence >= 0.62)
    .reduce((minimum, candidate) => Math.min(minimum, candidate.pageIndex), Number.POSITIVE_INFINITY);
  for (const candidate of candidates) {
    if (candidate.kind === 'aboutAuthor' && candidate.pageIndex < firstConfirmedBodyPage
      && /^(?:contributors?|about (?:the )?authors?)\b/iu.test(candidate.title)) {
      candidate.kind = 'unknownFront';
      candidate.level = 0;
      candidate.evidence.push('contributor material occurs before the first confirmed body section');
    }
  }
  const deduped = dedupeCandidates(candidates);
  const suppressedNavigation = deduped.filter((candidate) => NAVIGABLE_KINDS.has(candidate.kind) && candidate.confidence < 0.62)
    .map((candidate) => ({ title: candidate.title, pageIndex: candidate.pageIndex, confidence: candidate.confidence,
      evidence: candidate.evidence, reason: 'confidence below navigation threshold' }));
  const accepted = deduped.filter((candidate) => !NAVIGABLE_KINDS.has(candidate.kind) || candidate.confidence >= 0.62)
    .sort((a, b) => a.blockIndex - b.blockIndex || a.level - b.level || b.confidence - a.confidence);
  const ordered = enforceDocumentOrder(accepted, suppressedNavigation);
  if (!ordered.some((candidate) => !FRONT_KINDS.has(candidate.kind) && !BACK_KINDS.has(candidate.kind))) {
    const blockIndex = firstBodyBlock(blocks, pages);
    if (blockIndex >= 0) ordered.push({
      title: bookTitle,
      kind: 'body',
      pageIndex: blocks[blockIndex]!.anchor.pageIndex,
      blockIndex,
      level: 0,
      confidence: 0.68,
      evidence: ['first sustained prose after detected front matter'],
      source: 'page',
    });
  }
  ordered.sort((a, b) => a.blockIndex - b.blockIndex || a.level - b.level);
  const sections: SectionNode[] = ordered.map((candidate, index) => ({
    id: `section-${index}`,
    title: candidate.title,
    kind: candidate.kind,
    level: Math.max(0, candidate.level),
    parentId: undefined,
    startBlock: candidate.blockIndex,
    endBlock: blocks.length - 1,
    startUnit: -1,
    endUnit: -1,
    startPage: candidate.pageIndex,
    endPage: pages.length ? pages.length - 1 : candidate.pageIndex,
    anchor: blocks[candidate.blockIndex]?.anchor ?? makeAnchor(candidate.pageIndex, pages[candidate.pageIndex]?.label, 0, 0, candidate.title),
    confidence: candidate.confidence,
    evidence: candidate.evidence,
  }));
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index]!;
    const next = sections[index + 1];
    if (next) {
      section.endBlock = Math.max(section.startBlock, next.startBlock - 1);
      section.endPage = Math.max(section.startPage, next.startPage - (next.startBlock === section.startBlock ? 0 : 1));
    }
    for (let previous = index - 1; previous >= 0; previous--) {
      if (sections[previous]!.level < section.level) { section.parentId = sections[previous]!.id; break; }
    }
  }
  return { sections, suppressedNavigation };
}

function expandedHeadingTitle(blocks: InternalBlock[], blockIndex: number, kind: SemanticSectionKind): string {
  const base = blocks[blockIndex]!;
  const expandable = new Set<SemanticSectionKind>([
    'part', 'chapter', 'section', 'foreword', 'preface', 'introduction', 'conclusion',
    'epilogue', 'appendix', 'glossary',
  ]);
  const pieces = [cleanHeading(base.text)];
  if (!expandable.has(kind)) return pieces[0]!;
  let subtitleSize = 0;
  for (let index = blockIndex + 1; index < Math.min(blocks.length, blockIndex + 5); index++) {
    const next = blocks[index]!;
    if (next.anchor.pageIndex !== base.anchor.pageIndex || next.kind !== 'heading' || classifySectionTitle(next.text)) break;
    if (subtitleSize && next.fontSize && Math.abs(next.fontSize - subtitleSize) > 0.9) break;
    if (!subtitleSize) subtitleSize = next.fontSize ?? 0;
    pieces.push(cleanHeading(next.text));
    if (pieces.join(' ').length > 180) break;
  }
  if (pieces.length === 1) return pieces[0]!;
  return `${pieces[0]}: ${pieces.slice(1).join(' ')}`;
}

function detectPageSections(blocks: InternalBlock[], pages: PDFPageExtraction[], bookTitle: string): SectionCandidate[] {
  const result: SectionCandidate[] = [];
  for (const page of pages.slice(0, Math.min(20, pages.length))) {
    const pageBlocks = blocks.map((block, index) => ({ block, index })).filter(({ block }) => block.anchor.pageIndex === page.index);
    const text = pageBlocks.map(({ block }) => block.text).join(' ');
    let kind: SemanticSectionKind | undefined;
    let title = '';
    let confidence = 0;
    let evidence: string[] = [];
    if (/\b(?:copyright|all rights reserved|ISBN|library of congress|creative commons|published by)\b|©/iu.test(text)) {
      kind = 'copyright'; title = 'Copyright'; confidence = 0.96; evidence = ['copyright and publication identifiers'];
    } else if (/(?:^|\s)(?:table of )?contents(?:\s|$)/iu.test(text) && (text.match(/\.{2,}|\s\d{1,4}\b/gu)?.length ?? 0) >= 2) {
      kind = 'contents'; title = 'Contents'; confidence = 0.94; evidence = ['contents label and page destinations'];
    } else if (/^(?:to|for)\s+.{2,120}$/iu.test(text.trim()) && pageBlocks.length <= 4) {
      kind = 'dedication'; title = 'Dedication'; confidence = 0.8; evidence = ['short isolated dedication phrase'];
    } else if (page.index <= 3 && titleSimilarity(text, bookTitle) >= 0.55 && pageBlocks.some(({ block }) => block.kind === 'heading')) {
      kind = 'titlePage'; title = 'Title page'; confidence = 0.86; evidence = ['book title in prominent opening typography'];
    } else if (page.index === 0 && pageBlocks.length <= 3) {
      kind = 'cover'; title = 'Cover'; confidence = 0.65; evidence = ['sparse first page'];
    }
    if (!kind || !pageBlocks.length) continue;
    result.push({ title, kind, pageIndex: page.index, blockIndex: pageBlocks[0]!.index, level: 0,
      confidence, evidence, source: 'page' });
  }
  return result;
}

function parseTOCEntries(blocks: InternalBlock[]): Array<{ title: string; printedPage: number; pageIndex?: number }> {
  const entries: Array<{ title: string; printedPage: number; pageIndex?: number }> = [];
  const tocPageIndices = new Set(blocks.filter(({ text }) => /^(?:table of )?contents$/iu.test(text)).map(({ anchor }) => anchor.pageIndex));
  for (const block of blocks) {
    if (!tocPageIndices.has(block.anchor.pageIndex) && ![...tocPageIndices].some((page) => block.anchor.pageIndex === page + 1)) continue;
    const match = block.text.match(/^(.*?)\s*(?:\.{2,}|\s{2,})(\d{1,4})\s*$/u);
    if (!match || cleanLine(match[1]!).length < 2) continue;
    entries.push({ title: cleanHeading(match[1]!), printedPage: Number(match[2]) });
  }
  const offsets = new Map<number, number>();
  for (const entry of entries) {
    for (const block of blocks) {
      if (block.kind !== 'heading' || titleSimilarity(block.text, entry.title) < 0.85) continue;
      const offset = block.anchor.pageIndex - entry.printedPage;
      offsets.set(offset, (offsets.get(offset) ?? 0) + 1);
    }
  }
  const calibration = [...offsets].sort((a, b) => b[1] - a[1])[0];
  if (calibration && calibration[1] >= 2) entries.forEach((entry) => { entry.pageIndex = entry.printedPage + calibration[0]; });
  return entries;
}

function classifySectionTitle(value: string): { kind: SemanticSectionKind; level: number } | undefined {
  const text = normalizeKey(value);
  if (/^(?:cover)$/.test(text)) return { kind: 'cover', level: 0 };
  if (/^(?:title page)$/.test(text)) return { kind: 'titlePage', level: 0 };
  if (/^(?:copyright|imprint|license|publication details?)\b/.test(text)) return { kind: 'copyright', level: 0 };
  if (/^(?:dedication)$/.test(text)) return { kind: 'dedication', level: 0 };
  if (/^(?:(?:table of )?contents)$/.test(text)) return { kind: 'contents', level: 0 };
  if (/^(?:foreword)\b/.test(text)) return { kind: 'foreword', level: 1 };
  if (/^(?:preface)\b/.test(text)) return { kind: 'preface', level: 1 };
  if (/^acknowledg(?:e)?ments?\b/.test(text)) return { kind: 'acknowledgments', level: 1 };
  if (/^(?:introduction|prologue)\b/.test(text)) return { kind: 'introduction', level: 1 };
  if (PART_PATTERN.test(value)) return { kind: 'part', level: 0 };
  if (CHAPTER_PATTERN.test(value)) return { kind: 'chapter', level: 1 };
  if (/^(?:conclusion)\b/.test(text)) return { kind: 'conclusion', level: 1 };
  if (/^(?:epilogue|afterword)\b/.test(text)) return { kind: 'epilogue', level: 1 };
  if (/^(?:appendix|appendices)\b/.test(text)) return { kind: 'appendix', level: 1 };
  if (/^(?:glossary|list of abbreviations)\b/.test(text)) return { kind: 'glossary', level: 1 };
  if (/^(?:notes|endnotes|footnotes)\b/.test(text)) return { kind: 'notes', level: 1 };
  if (/^(?:bibliography|references|works cited|further reading)\b/.test(text)) return { kind: 'bibliography', level: 1 };
  if (/^(?:index)\b/.test(text)) return { kind: 'index', level: 1 };
  if (/^(?:about (?:the )?author|contributors?|author biography)\b/.test(text)) return { kind: 'aboutAuthor', level: 1 };
  if (/^(?:colophon)\b/.test(text)) return { kind: 'colophon', level: 1 };
  return undefined;
}

function dedupeCandidates(candidates: SectionCandidate[]): SectionCandidate[] {
  const result: SectionCandidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.blockIndex - b.blockIndex || b.confidence - a.confidence)) {
    const duplicate = result.find((item) => Math.abs(item.blockIndex - candidate.blockIndex) <= 1
      && (item.kind === candidate.kind || titleSimilarity(item.title, candidate.title) >= 0.72));
    if (!duplicate) result.push(candidate);
    else if (candidate.confidence > duplicate.confidence) Object.assign(duplicate, candidate);
    else duplicate.evidence = unique([...duplicate.evidence, ...candidate.evidence]);
  }
  return result;
}

function enforceDocumentOrder(candidates: SectionCandidate[], suppressed: ParseDiagnostics['suppressedNavigation']): SectionCandidate[] {
  const result: SectionCandidate[] = [];
  let bodySeen = false;
  for (const candidate of candidates) {
    const isFront = FRONT_KINDS.has(candidate.kind);
    const isBack = BACK_KINDS.has(candidate.kind);
    if (isFront && bodySeen) {
      suppressed.push({ title: candidate.title, pageIndex: candidate.pageIndex, confidence: candidate.confidence,
        evidence: candidate.evidence, reason: 'front-matter label occurred after body began' });
      continue;
    }
    if (!isFront && !isBack) bodySeen = true;
    // Collected works legitimately place references, contributor notes, and
    // acknowledgments between chapters. Preserve the chronological candidates;
    // hierarchy and confidence decide navigation instead of a one-way back-matter flag.
    result.push(candidate);
  }
  return result;
}

function assignSections(blocks: InternalBlock[], sections: SectionNode[]): void {
  for (let index = 0; index < blocks.length; index++) {
    const section = [...sections].reverse().find((candidate) => candidate.startBlock <= index);
    if (section) blocks[index]!.sectionId = section.id;
    if (section?.kind === 'bibliography' || section?.kind === 'notes' || section?.kind === 'index') {
      if (blocks[index]!.kind === 'prose') blocks[index]!.kind = 'reference';
    }
  }
}

function buildPassages(blocks: InternalBlock[], sections: SectionNode[]): Passage[] {
  const result: Passage[] = [];
  for (const section of sections) {
    if (!PRIMARY_KINDS.has(section.kind)) continue;
    const candidates = blocks.slice(section.startBlock, section.endBlock + 1)
      .filter((block) => block.kind === 'prose');
    if (!candidates.length) continue;
    let text = '';
    const segments: PassageSegment[] = [];
    for (const block of candidates) {
      if (text) text += ' ';
      const start = text.length;
      text += block.text;
      segments.push({ start, end: text.length, block });
    }
    result.push({ section, text, segments });
  }
  return result;
}

async function sentenceBoundaries(texts: string[], tokenize?: SentenceTokenizer): Promise<number[][]> {
  if (!texts.length) return [];
  if (tokenize) {
    try {
      const result = await tokenize(texts);
      if (result.length === texts.length) return result;
    } catch {
      // Older native development clients fall back to the deterministic guard parser.
    }
  }
  return texts.map((text) => sentenceSpans(text).map((span) => span.start + span.text.length));
}

function buildReadingUnits(passages: Passage[], proposals: number[][]): ReadingUnit[] {
  const units: ReadingUnit[] = [];
  passages.forEach((passage, passageIndex) => {
    const spans = sentenceSpans(passage.text, proposals[passageIndex]);
    for (let index = 0; index < spans.length; index += 2) {
      const pair = spans.slice(index, index + 2);
      const first = pair[0]!;
      const last = pair.at(-1)!;
      const start = first.start;
      const end = last.start + last.text.length;
      const startSegment = segmentAt(passage.segments, start);
      const endSegment = segmentAt(passage.segments, Math.max(start, end - 1));
      const sourcePages = unique(passage.segments.filter((segment) => segment.end > start && segment.start < end)
        .map(({ block }) => block.anchor.pageIndex));
      const text = pair.map(({ text: sentence }) => sentence).join(' ');
      const anchor = anchorWithinSegment(startSegment, start - startSegment.start, text);
      const endAnchor = anchorWithinSegment(endSegment, Math.max(0, end - endSegment.start), text);
      const sentences = pair.map((sentence) => {
        const sentenceStartSegment = segmentAt(passage.segments, sentence.start);
        const sentenceEnd = sentence.start + sentence.text.length;
        const sentenceEndSegment = segmentAt(passage.segments, Math.max(sentence.start, sentenceEnd - 1));
        return {
          text: sentence.text,
          anchor: anchorWithinSegment(sentenceStartSegment, sentence.start - sentenceStartSegment.start, sentence.text),
          endAnchor: anchorWithinSegment(sentenceEndSegment, Math.max(0, sentenceEnd - sentenceEndSegment.start), sentence.text),
        };
      });
      units.push({
        id: `unit-${units.length}`,
        text,
        sentenceCount: pair.length,
        sectionId: passage.section.id,
        heading: index === 0 ? passage.section.title : undefined,
        anchor,
        endAnchor,
        sourcePages,
        wordCount: text.match(/\S+/gu)?.length ?? 0,
        supplementIds: [],
        sentences,
      });
    }
  });
  return units;
}

function buildSupplements(blocks: InternalBlock[], sections: SectionNode[], units: ReadingUnit[]): ContextualSupplement[] {
  const secondary = new Set<ContentBlockKind>(['footnote', 'caption', 'table', 'reference']);
  return blocks.filter((block) => secondary.has(block.kind)).map((block, index) => {
    const section = sections.find(({ id }) => id === block.sectionId);
    const closest = closestUnit(units, block.anchor.pageIndex, section?.id);
    return {
      id: `supplement-${index}`,
      kind: block.kind as ContextualSupplement['kind'],
      text: block.text,
      anchor: block.anchor,
      relatedBlockIds: closest ? [closest.id, block.id] : [block.id],
      confidence: block.confidence,
      evidence: [...block.evidence, closest ? 'attached to nearest primary reading unit' : 'retained without a primary reading unit'],
    };
  });
}

function attachSupplements(units: ReadingUnit[], supplements: ContextualSupplement[]): void {
  for (const supplement of supplements) {
    const unitID = supplement.relatedBlockIds.find((id) => id.startsWith('unit-'));
    const unit = units.find(({ id }) => id === unitID);
    if (unit) unit.supplementIds.push(supplement.id);
  }
}

function finalizeSectionRanges(sections: SectionNode[], blocks: InternalBlock[], units: ReadingUnit[]): void {
  for (const section of sections) {
    const sectionUnits = units.map((unit, index) => ({ unit, index })).filter(({ unit }) => unit.sectionId === section.id);
    section.startUnit = sectionUnits[0]?.index ?? -1;
    section.endUnit = sectionUnits.at(-1)?.index ?? -1;
    const lastBlock = blocks[section.endBlock];
    if (lastBlock) section.endPage = Math.max(section.startPage, lastBlock.anchor.pageIndex);
  }
}

function determineReadingStart(sections: SectionNode[], units: ReadingUnit[]): number {
  const section = sections.find((candidate) => BODY_START_KINDS.has(candidate.kind) && candidate.startUnit >= 0);
  return Math.max(0, section?.startUnit ?? (units.length ? 0 : -1));
}

export function remapReadingPosition(anchor: SourceAnchor | undefined, units: ReadingUnit[]): {
  index: number;
  confidence: number;
  evidence: string[];
} {
  if (!units.length) return { index: 0, confidence: 0, evidence: ['new parse has no reading units'] };
  if (!anchor) return { index: 0, confidence: 0, evidence: ['old position had no source anchor'] };
  const exact = units.findIndex((unit) => unit.anchor.contextHash === anchor.contextHash);
  if (exact >= 0) return { index: exact, confidence: 0.995, evidence: ['exact normalized context hash'] };
  const scored = units.map((unit, index) => {
    const context = contextSimilarity(anchor.contextText ?? '', unit.anchor.contextText ?? unit.text);
    const samePage = unit.sourcePages.includes(anchor.pageIndex);
    const distance = Math.min(...unit.sourcePages.map((page) => Math.abs(page - anchor.pageIndex)));
    const score = context * 0.82 + (samePage ? 0.16 : Math.max(0, 0.08 - distance * 0.02));
    return { index, score, context, samePage };
  }).sort((a, b) => b.score - a.score)[0]!;
  const confidence = scored.context >= 0.92 && scored.samePage ? Math.max(0.9, scored.score) : Math.min(0.89, scored.score);
  return { index: scored.index, confidence, evidence: [
    `${Math.round(scored.context * 100)}% normalized context similarity`,
    scored.samePage ? 'same source PDF page' : 'nearest source-page candidate',
  ] };
}

export function sourceAnchorForLegacy(text: string, pageIndex: number): SourceAnchor {
  return makeAnchor(pageIndex, undefined, 0, text.length, text);
}

function legacyChapterKind(kind: SemanticSectionKind): Chapter['kind'] {
  if (FRONT_KINDS.has(kind)) return 'frontMatter';
  if (BACK_KINDS.has(kind)) return 'backMatter';
  if (kind === 'part') return 'part';
  if (kind === 'section') return 'section';
  return 'chapter';
}

function firstBodyBlock(blocks: InternalBlock[], pages: PDFPageExtraction[]): number {
  const frontPages = new Set(detectPageSections(blocks, pages, '').filter((item) => FRONT_KINDS.has(item.kind)).map(({ pageIndex }) => pageIndex));
  const candidates = blocks.map((block, index) => ({ block, index })).filter(({ block }) => block.kind === 'prose' && !frontPages.has(block.anchor.pageIndex));
  const sustained = candidates.find(({ index }) => blocks.slice(index, index + 3).filter(({ kind }) => kind === 'prose').length >= 2);
  return sustained?.index ?? candidates[0]?.index ?? -1;
}

function firstBlockOnOrAfterPage(blocks: InternalBlock[], pageIndex: number): number {
  const index = blocks.findIndex((block) => block.anchor.pageIndex >= pageIndex);
  return index < 0 ? Math.max(0, blocks.length - 1) : index;
}

function segmentAt(segments: PassageSegment[], offset: number): PassageSegment {
  return segments.find((segment) => offset >= segment.start && offset < segment.end)
    ?? segments.findLast((segment) => segment.start <= offset)
    ?? segments[0]!;
}

function anchorWithinSegment(segment: PassageSegment, relativeOffset: number, context: string): SourceAnchor {
  const blockLength = Math.max(1, segment.end - segment.start);
  const sourceLength = Math.max(0, segment.block.anchor.sourceEnd - segment.block.anchor.sourceStart);
  const sourceOffset = Math.min(sourceLength, Math.max(0, Math.round(relativeOffset / blockLength * sourceLength)));
  const sourceStart = segment.block.anchor.sourceStart + sourceOffset;
  return makeAnchor(
    segment.block.anchor.pageIndex,
    segment.block.anchor.pageLabel,
    sourceStart,
    sourceStart + Math.min(context.length, Math.max(0, sourceLength - sourceOffset)),
    context,
  );
}

function closestUnit(units: ReadingUnit[], pageIndex: number, sectionId?: string): ReadingUnit | undefined {
  return [...units].sort((a, b) => {
    const sectionPenaltyA = sectionId && a.sectionId !== sectionId ? 1000 : 0;
    const sectionPenaltyB = sectionId && b.sectionId !== sectionId ? 1000 : 0;
    return sectionPenaltyA + Math.min(...a.sourcePages.map((page) => Math.abs(page - pageIndex)))
      - sectionPenaltyB - Math.min(...b.sourcePages.map((page) => Math.abs(page - pageIndex)));
  })[0];
}

function stripInternalBlock(block: InternalBlock): ContentBlock {
  const { pageHeight: _pageHeight, pageWidth: _pageWidth, centered: _centered,
    bold: _bold, italic: _italic, ...publicBlock } = block;
  return publicBlock;
}

function makeAnchor(pageIndex: number, pageLabel: string | undefined, sourceStart: number, sourceEnd: number, context: string): SourceAnchor {
  const contextText = normalizeContext(context).slice(0, 240);
  return { pageIndex, pageLabel, sourceStart, sourceEnd, contextText, contextHash: hashContext(contextText) };
}

export function hashContext(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function contextSimilarity(a: string, b: string): number {
  const left = new Set(contextNgrams(a));
  const right = new Set(contextNgrams(b));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  left.forEach((value) => { if (right.has(value)) intersection++; });
  return 2 * intersection / (left.size + right.size);
}

function contextNgrams(value: string): string[] {
  const words = normalizeContext(value).split(' ').filter(Boolean);
  if (words.length < 3) return words;
  return words.slice(0, -2).map((_word, index) => words.slice(index, index + 3).join(' '));
}

function normalizeContext(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function titleSimilarity(a: string, b: string): number {
  const left = normalizeKey(a);
  const right = normalizeKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  const leftWords = new Set(left.split(' '));
  const rightWords = new Set(right.split(' '));
  let intersection = 0;
  leftWords.forEach((word) => { if (rightWords.has(word)) intersection++; });
  return 2 * intersection / (leftWords.size + rightWords.size);
}

function isPlausibleTitle(value: string): boolean {
  const text = cleanLine(value);
  if (text.length < 3 || text.length > 180 || /^(?:untitled|unknown|document|ebook|book)$/iu.test(text)) return false;
  if (/^(?:copyright|contents|table of contents|isbn|published by|chapter|part)\b/iu.test(text)) return false;
  return text.split(/\s+/u).length <= 24 && !TERMINAL_PROSE.test(text);
}

function furnitureKey(value: string): string {
  return normalizeKey(value)
    .replace(/\b(?:page\s+)?\d+(?:\s+(?:of|\/)\s+\d+)?\b/gu, '#')
    .replace(/\b[ivxlcdm]+\b/giu, '#')
    .trim();
}

function normalizeKey(value: string): string {
  return cleanLine(value).normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function cleanHeading(value: string): string {
  return cleanLine(value).replace(/\s+[.·…]{2,}\s*\d+\s*$/u, '').replace(/[\s:;,.]+$/u, '');
}

function cleanLine(value: string): string {
  return value.replace(/[\u0000\u0008\uFFFD]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function joinSpans(spans: PDFTextSpan[]): string {
  let result = '';
  for (const span of spans) {
    if (result && span.sourceStart > 0 && !/\s$/u.test(result) && !/^\s|^[,.;:!?)}\]]/u.test(span.text)) result += ' ';
    result += span.text;
  }
  return result;
}

function joinPDFLines(lines: string[]): string {
  let result = '';
  for (const line of lines) {
    const next = cleanLine(line);
    if (!next) continue;
    if (result.endsWith('-') && /^\p{Ll}/u.test(next)) result = result.slice(0, -1) + next;
    else result += (result ? ' ' : '') + next;
  }
  return result;
}

function looksTabular(text: string): boolean {
  return (text.match(/\s{2,}/gu)?.length ?? 0) >= 2 || (text.match(/\|/gu)?.length ?? 0) >= 2
    || /^(?:\S+\s+){0,2}\d+(?:[.,]\d+)?(?:\s+\d+(?:[.,]\d+)?){2,}$/u.test(text);
}

function isPageNumberLine(text: string): boolean {
  return /^(?:page\s+)?(?:\d{1,5}|[ivxlcdm]{1,12})(?:\s+(?:of|\/)\s+\d{1,5})?$/iu.test(cleanLine(text));
}

function unionRects(rects: SourceRect[]): SourceRect {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...rects.map(({ x }) => x));
  const top = Math.min(...rects.map(({ y }) => y));
  const right = Math.max(...rects.map(({ x, width }) => x + width));
  const bottom = Math.max(...rects.map(({ y, height }) => y + height));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function groupBy<T, K>(values: T[], key: (value: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  values.forEach((value) => result.set(key(value), [...(result.get(key(value)) ?? []), value]));
  return result;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => { const identity = key(value); if (seen.has(identity)) return false; seen.add(identity); return true; });
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value! : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stripExtension(value: string): string {
  return value.replace(/\.[^.]+$/u, '');
}
