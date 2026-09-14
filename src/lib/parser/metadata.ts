import type { PDFExtractionResult, PDFPageExtraction } from '../../../modules/pdf-text-extractor/src/PDFTextExtractor.types';
import type { InternalBlock, LayoutLine } from './types';
import type { BookMetadata } from '../../types';
import { stripExtension, cleanLine, isPlausibleTitle, titleSimilarity, normalizeKey, unique, joinPDFLines } from './utils';
import { linesFromPage } from './layout';
import { classifySectionTitle } from './policy';

export function inferMetadata(
  extraction: PDFExtractionResult,
  originalFileName: string,
  blocks: InternalBlock[],
  pages: PDFPageExtraction[],
): BookMetadata {
  const fallback = stripExtension(originalFileName).trim() || 'Untitled book';
  const rawMetadataTitle = cleanLine(extraction.metadata?.title ?? extraction.title ?? '');
  const opening = blocks.filter(({ anchor }) => anchor.pageIndex < Math.min(6, pages.length));
  const metadataUsable = isPlausibleTitle(rawMetadataTitle);
  const titleGroups = openingTitleGroups(pages);
  const candidates = titleGroups.map((group) => {
    const pageMaximum = Math.max(...titleGroups.filter((other) => other.pageIndex === group.pageIndex).map(({ size }) => size));
    const repeated = titleGroups.some((other) => other.pageIndex !== group.pageIndex && (titleSimilarity(other.text, group.text) >= 0.88
      || normalizeKey(other.text).startsWith(normalizeKey(group.text) + ' ')));
    const supported = metadataUsable && (titleSimilarity(rawMetadataTitle, group.text) >= 0.7
      || normalizeKey(rawMetadataTitle).startsWith(normalizeKey(group.text) + ' '));
    const spread = pages[group.pageIndex]!.width > pages[group.pageIndex]!.height * 1.2;
    return { ...group, score: Math.min(0.97, 0.3 + 0.25 * group.size / pageMaximum
      + Math.min(0.12, group.size / 400) + (repeated ? 0.18 : 0) + (supported ? 0.24 : 0)
      + (group.pageIndex <= 1 ? 0.05 : 0) - (spread ? 0.2 : 0)) };
  }).sort((a, b) => b.score - a.score);
  const pageTitle = candidates[0];
  const corroborated = pageTitle && metadataUsable && titleSimilarity(rawMetadataTitle, pageTitle.text) >= 0.7;
  const metadataWords = normalizeKey(rawMetadataTitle).split(' ').filter(Boolean);
  const prominentWords = new Set(pages.slice(0, 6).flatMap((page) => page.spans.filter((span) => span.fontSize >= 14)
    .flatMap((span) => normalizeKey(span.text).split(' '))));
  const metadataSupported = metadataUsable && metadataWords.every((word) => prominentWords.has(word));
  const title = metadataSupported && (!pageTitle || !normalizeKey(rawMetadataTitle).startsWith(normalizeKey(pageTitle.text))
    || pageTitle.text.split(/\s+/u).length <= 2 && metadataWords.length <= pageTitle.text.split(/\s+/u).length + 1)
    ? { value: rawMetadataTitle, confidence: 0.9, evidence: ['PDF metadata title words corroborated in prominent opening spans'] }
    : pageTitle
      ? { value: normalizeKey(rawMetadataTitle) === normalizeKey(pageTitle.text) ? rawMetadataTitle : pageTitle.text,
        confidence: pageTitle.score, evidence: ['grouped opening-page title typography', ...(corroborated ? ['matching PDF metadata'] : [])] }
      : metadataUsable
        ? { value: rawMetadataTitle, confidence: 0.78, evidence: ['PDF metadata title; no typographic confirmation'] }
      : { value: fallback, confidence: 0.45, evidence: ['normalized PDF filename fallback'] };
  const titleIndex = pageTitle ? opening.findIndex((block) => block.anchor.pageIndex === pageTitle.pageIndex && titleSimilarity(block.text, pageTitle.text) >= 0.5) : -1;
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

export function openingTitleGroups(pages: PDFPageExtraction[]): Array<{ text: string; size: number; pageIndex: number }> {
  const result: Array<{ text: string; size: number; pageIndex: number }> = [];
  for (const page of pages.slice(0, 6)) {
    const pageLines = linesFromPage(page);
    // A contents page can use large type for chapter entries even when the
    // actual cover/title page is an image. Those entries are not book titles.
    if (pageLines.some(line => /^(?:table of )?contents$/iu.test(line.text))) continue;
    const lines = pageLines.filter((line) => line.fontSize >= 14 && line.text.length >= 2)
      .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
    let group: LayoutLine[] = [];
    const flush = () => {
      if (!group.length) return;
      const text = joinPDFLines(group.map(({ text }) => text));
      if (isPlausibleTitle(text) && !classifySectionTitle(text) && !/[·•]/u.test(text)
        && !/\b(?:editors?|edited by|series|editorial|volume\s+\d|lecture notes|springer briefs|monographs|foreword|preface)\b/iu.test(text)) {
        result.push({ text, size: group[0]!.fontSize, pageIndex: page.index });
      }
      group = [];
    };
    for (const line of lines) {
      const previous = group.at(-1);
      if (previous && (Math.abs(previous.fontSize - line.fontSize) > Math.max(0.8, previous.fontSize * 0.06)
        || line.bounds.y - previous.bounds.y > previous.fontSize * 2.4
        || line.bounds.y <= previous.bounds.y
        || !(Math.abs(previous.bounds.x - line.bounds.x) < page.width * 0.16
          || Math.abs(previous.bounds.x + previous.bounds.width / 2 - line.bounds.x - line.bounds.width / 2) < page.width * 0.08))) flush();
      group.push(line);
    }
    flush();
  }
  return result;
}
