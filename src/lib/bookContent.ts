import type { BookContent, BookFormat, ReaderPreferences } from '../types';
import type { ParsedEbook } from './contentParser';
import { CONTENT_PARSER_VERSION } from './contentParser';
import { CHAPTER_VERSION, detectBookStructure } from './bookStructure';
import { repairQuotationBoundaries } from './paragraphize';
import { EPUB_PARSER_VERSION } from './epub/parser';

export const defaultPreferences: ReaderPreferences = { fontSize: 24, theme: 'paper' };

export function contentFromParsed(parsed: ParsedEbook, uri: string, layoutRevision: string, format: BookFormat = 'pdf'): BookContent {
  return { ...parsed, source: { format, uri }, ...(format === 'pdf' ? { pdfUri: uri, chapterVersion: CHAPTER_VERSION } : {}),
    layoutRevision, parserVersion: format === 'epub' ? EPUB_PARSER_VERSION : CONTENT_PARSER_VERSION };
}

export function normalizeStoredContent(serialized: string, chapterData: string | null): BookContent | null {
  try {
    const parsed = JSON.parse(serialized) as Partial<BookContent>;
    const isEpub = parsed.source?.format === 'epub';
    let chapterMetadata: Partial<BookContent> = {};
    try { chapterMetadata = chapterData ? JSON.parse(chapterData) : {}; } catch { /* Keep original metadata. */ }
    // A full reparse is authoritative over an equal/older navigation-only scan.
    // Otherwise reopening could replace newly repaired chapters with stale ones.
    if (isEpub || chapterMetadata.layoutRevision != null && chapterMetadata.layoutRevision !== parsed.layoutRevision
      || (chapterMetadata.chapterVersion ?? 0) <= (parsed.chapterVersion ?? 0)) chapterMetadata = {};
    const savedParagraphs = Array.isArray(parsed.paragraphs) ? parsed.paragraphs : [];
    const paragraphs = isEpub ? savedParagraphs : repairQuotationBoundaries(savedParagraphs);
    const storedChapters = Array.isArray(parsed.chapters) ? parsed.chapters : undefined;
    const storedReadingStart =
      typeof parsed.readingStart === 'number' ? parsed.readingStart : undefined;
    const detected = isEpub || storedChapters && storedReadingStart != null ? null : detectBookStructure(paragraphs);
    const content: BookContent = {
      chapters: Array.isArray(chapterMetadata.chapters) ? chapterMetadata.chapters : storedChapters ?? detected?.chapters ?? [],
      chapterVersion: chapterMetadata.chapterVersion ?? parsed.chapterVersion,
      parserVersion:
        typeof parsed.parserVersion === 'number' ? parsed.parserVersion : undefined,
      ...(!isEpub ? { pdfUri: parsed.pdfUri ?? '' } : {}),
      paragraphs,
      paragraphPages: Array.isArray(parsed.paragraphPages) && parsed.paragraphPages.length === paragraphs.length
        ? parsed.paragraphPages : undefined,
      readingStart: storedReadingStart ?? detected?.readingStart ?? 0,
    };
    if (parsed.source) content.source = parsed.source;
    if (parsed.metadata) content.metadata = parsed.metadata;
    if (Array.isArray(parsed.sections)) content.sections = parsed.sections;
    if (Array.isArray(parsed.blocks)) content.blocks = parsed.blocks;
    if (Array.isArray(parsed.readingUnits) && parsed.readingUnits.length === paragraphs.length) content.readingUnits = parsed.readingUnits;
    if (Array.isArray(parsed.supplements)) content.supplements = parsed.supplements;
    if (parsed.diagnostics) content.diagnostics = parsed.diagnostics;
    if (typeof parsed.layoutRevision === 'string') content.layoutRevision = parsed.layoutRevision;
    return content;
  } catch {
    return null;
  }
}
