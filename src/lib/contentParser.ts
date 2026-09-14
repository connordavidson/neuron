import type { BookMetadata, SectionNode, ContentBlock, ReadingUnit, ContextualSupplement, ParseDiagnostics, Chapter } from '../types';
import type { PDFExtractionResult } from '../../modules/pdf-text-extractor/src/PDFTextExtractor.types';
import { normalizedPages, linesFromPage, detectRunningFurniture, reconstructBlocks } from './parser/layout';
import { inferMetadata } from './parser/metadata';
import { detectSections } from './parser/sections';
import { assignSections, buildPassages, buildSupplements, attachSupplements, finalizeSectionRanges, determineReadingStart, legacyChapterKind, stripInternalBlock } from './parser/flow';
import { proposedSentenceBoundaries, generateReadingUnits } from './readingUnits';
import { NAVIGABLE_KINDS } from './parser/policy';

export const CONTENT_PARSER_VERSION = 9;

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
  const proposals = await proposedSentenceBoundaries(passages.map(({ text }) => text), tokenize);
  const readingUnits = generateReadingUnits(passages, proposals);
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

export { hashContext, remapReadingPosition, sourceAnchorForLegacy } from './readingUnits';
