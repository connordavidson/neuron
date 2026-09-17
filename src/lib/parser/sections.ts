import { collectChapterEvidence, headingKey, tocPages as sourceTOCPages } from '../sourceNavigation';
import type { PDFExtractionResult, PDFPageExtraction } from '../../../modules/pdf-text-extractor/src/PDFTextExtractor.types';
import type { InternalBlock, SectionCandidate } from './types';
import type { SectionNode, ParseDiagnostics, SemanticSectionKind } from '../../types';
import { EXPLICIT_NUMBER, classifySectionTitle, CHAPTER_PATTERN, PART_PATTERN, NUMBERED_SECTION_PATTERN, TERMINAL_PROSE, BODY_START_KINDS, NAVIGABLE_KINDS, FRONT_KINDS, BACK_KINDS } from './policy';
import { titleSimilarity, cleanHeading, clamp01, cleanLine, normalizeKey, unique } from './utils';
import { makeSourceAnchor } from '../readingUnits';

export function detectSections(
  extraction: PDFExtractionResult,
  blocks: InternalBlock[],
  pages: PDFPageExtraction[],
  bookTitle: string,
): { sections: SectionNode[]; suppressedNavigation: ParseDiagnostics['suppressedNavigation'] } {
  const candidates: SectionCandidate[] = [];
  const outlineItems = extraction.outlines ?? [];
  const outlineMatches = outlineItems.map((item) => ({ item, blockIndex: matchingOutlineBlock(item, blocks, pages) }));
  const numberedOutlineLevels = outlineItems.filter((item) => /^\s*(?:one|two|three|\d+|[IVX]+)\s*[:.]\s+/iu.test(item.title)).map((item) => item.level ?? 0);
  const chapterOutlineLevel = numberedOutlineLevels.length >= 3 ? Math.min(...numberedOutlineLevels) : -1;
  const numberedOutline = (item: typeof outlineItems[number] | undefined) => Boolean(item && (item.level ?? 0) === chapterOutlineLevel
    && new RegExp(`^${EXPLICIT_NUMBER}\\s*[:.]\\s+`, 'iu').test(item.title));
  const tocEntries = parseTOCEntries(blocks);
  const tocPages = new Set(blocks.filter(({ text }) => /^(?:table of )?contents$/iu.test(text))
    .flatMap(({ anchor }) => [anchor.pageIndex, anchor.pageIndex + 1]));
  const rawTables = sourceTOCPages(extraction.pages);
  rawTables.forEach(page => tocPages.add(page));
  const sourceEvidence = collectChapterEvidence(extraction.pages, extraction.outlines, extraction.pageLineFonts);
  const headingBlocks = blocks.map((block, blockIndex) => ({ block, blockIndex }))
    .filter(({ block }) => block.kind === 'heading' && !tocPages.has(block.anchor.pageIndex));

  for (const { block, blockIndex } of headingBlocks) {
    const semantic = classifySectionTitle(block.text);
    const outline = outlineMatches.find((match) => match.blockIndex === blockIndex)?.item;
    const containingOutline = outlineItems.filter((item) => item.pageIndex <= block.anchor.pageIndex && item.pageIndex >= 0)
      .sort((a, b) => b.pageIndex - a.pageIndex)[0];
    const containingKind = containingOutline ? classifySectionTitle(containingOutline.title)?.kind : undefined;
    if (!outline && containingKind && ['notes', 'bibliography', 'index'].includes(containingKind)) continue;
    const toc = tocEntries.find((item) => titleSimilarity(item.title, block.text) >= 0.78
      && (item.pageIndex == null || Math.abs(item.pageIndex - block.anchor.pageIndex) <= 1));
    let kind = semantic?.kind;
    if (!kind && numberedOutline(outline)) kind = 'chapter';
    if (!kind && CHAPTER_PATTERN.test(block.text)) kind = 'chapter';
    if (!kind && PART_PATTERN.test(block.text)) kind = 'part';
    if (!kind && NUMBERED_SECTION_PATTERN.test(block.text)) kind = 'section';
    if (!kind && !outline && !toc) continue;
    const displayedTitle = outline ? cleanHeading(outline.title) : kind ? expandedHeadingTitle(blocks, blockIndex, kind) : cleanHeading(block.text);
    const explicit = Boolean(semantic || CHAPTER_PATTERN.test(block.text) || PART_PATTERN.test(block.text));
    let confidence = 0.2 + (explicit ? 0.34 : 0) + Math.max(0, block.confidence - 0.55) * 0.55;
    const evidence = [...block.evidence];
    if (outline) { confidence += 0.32; evidence.push('matching PDF outline destination'); }
    if (toc) { confidence += 0.2; evidence.push('matching spatial table-of-contents entry'); }
    if (block.bounds && block.bounds.y <= block.pageHeight * 0.28) { confidence += 0.08; evidence.push('near page top'); }
    if (TERMINAL_PROSE.test(block.text) && !outline && !toc) confidence -= 0.35;
    if (outline) confidence = Math.max(confidence, 0.94);
    candidates.push({
      title: displayedTitle,
      kind: kind ?? 'section',
      pageIndex: block.anchor.pageIndex,
      blockIndex,
      level: outline?.level ?? semantic?.level ?? ((kind ?? 'section') === 'part' ? 0 : (kind ?? 'section') === 'section' ? 2 : 1),
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
    const matchedIndex = outlineMatches.find((match) => match.item === item)?.blockIndex ?? -1;
    const confirmed = matchedIndex >= 0;
    const blockIndex = confirmed ? matchedIndex : firstBlockOnOrAfterPage(blocks, item.pageIndex);
    const confidence = confirmed ? 0.94 : explicit ? 0.78 : 0.56;
    candidates.push({
      title: cleanHeading(item.title),
      kind: semantic?.kind ?? (PART_PATTERN.test(item.title) ? 'part' : CHAPTER_PATTERN.test(item.title) || numberedOutline(item) ? 'chapter' : 'section'),
      pageIndex: item.pageIndex,
      blockIndex,
      level: item.level ?? semantic?.level ?? 1,
      confidence,
      evidence: ['PDF outline destination', confirmed ? 'matching complete destination title across extracted lines' : explicit ? 'recognized semantic label' : 'unconfirmed outline label'],
      source: 'outline',
    });
  }

  for (const source of sourceEvidence) {
    if (source.confidence < 0.62 || rawTables.has(source.pageIndex)) continue;
    const semantic = classifySectionTitle(source.title);
    const kind: SemanticSectionKind = semantic?.kind ?? (source.kind === 'part' ? 'part' : 'chapter');
    if (candidates.some(candidate => candidate.pageIndex === source.pageIndex && candidate.kind === kind
      && titleSimilarity(candidate.title, source.title) >= 0.7)) continue;
    const blockIndex = blocks.findIndex(block => block.anchor.pageIndex === source.pageIndex
      && block.anchor.sourceStart < source.sourceEnd && block.anchor.sourceEnd > source.sourceStart);
    if (blockIndex < 0) continue;
    // A bookmark for a subtitle must not create a second section inside the
    // same confirmed chapter heading and steal all of its reading units.
    for (let index = candidates.length - 1; index >= 0; index--) {
      const candidate = candidates[index]!;
      const block = blocks[candidate.blockIndex];
      if (kind === 'chapter' && candidate.kind === 'section' && block
        && candidate.pageIndex === source.pageIndex && block.anchor.sourceStart < source.sourceEnd
        && block.anchor.sourceEnd > source.sourceStart) candidates.splice(index, 1);
    }
    candidates.push({ title: cleanHeading(source.title), kind, pageIndex: source.pageIndex,
      blockIndex, level: semantic?.level ?? source.level ?? 1, source: source.source,
      confidence: source.confidence, evidence: source.evidence });
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
  // A complete chapter outline also establishes hierarchy. Unlisted "Part"
  // headings between its chapters are internal divisions, not book-level parts.
  // Keep their prose inside the containing chapter and out of the chapter picker.
  const outlineChapters = candidates.filter((candidate) => candidate.source === 'outline'
    && candidate.kind === 'chapter' && candidate.confidence >= 0.62)
    .sort((a, b) => a.blockIndex - b.blockIndex);
  const internalParts = new Set(candidates.filter((candidate) => {
    if (candidate.kind !== 'part' || candidate.source !== 'heading' || outlineChapters.length < 3) return false;
    const previous = outlineChapters.filter((chapter) => chapter.blockIndex < candidate.blockIndex).at(-1);
    const next = outlineChapters.find((chapter) => chapter.blockIndex > candidate.blockIndex);
    return previous && next && previous.level === next.level;
  }));
  const openingTitles = new Set(pageKinds.filter(candidate => candidate.kind === 'titlePage' || candidate.kind === 'cover').map(candidate => candidate.pageIndex));
  const repeated = new Map<string, number>();
  candidates.filter(candidate => candidate.source === 'heading' && candidate.kind === 'part').forEach(candidate => {
    const key = headingKey(candidate.title);
    repeated.set(key, (repeated.get(key) ?? 0) + 1);
  });
  const deduped = dedupeCandidates(candidates.filter(candidate => {
    if (internalParts.has(candidate)) return false;
    if (candidate.source === 'heading' && (candidate.kind === 'chapter' || candidate.kind === 'part')) {
      if (candidate.kind === 'part' && openingTitles.has(candidate.pageIndex) && candidate.pageIndex === 0
        && /copyright|all rights reserved|©/iu.test(pages[1]?.text ?? '')
        && !blocks.some(block => block.anchor.pageIndex === 0 && block.kind === 'prose' && /[.!?]/u.test(block.text))) return false;
      if (candidate.kind === 'part' && (repeated.get(headingKey(candidate.title)) ?? 0) >= 3
        && !sourceEvidence.some(source => source.pageIndex === candidate.pageIndex && source.confidence >= 0.62
          && headingKey(source.title) === headingKey(candidate.title))) return false;
    }
    return true;
  }));
  const suppressedNavigation = deduped.filter((candidate) => NAVIGABLE_KINDS.has(candidate.kind) && candidate.confidence < 0.62)
    .map((candidate) => ({ title: candidate.title, pageIndex: candidate.pageIndex, confidence: candidate.confidence,
      evidence: candidate.evidence, reason: 'confidence below navigation threshold' }));
  for (const candidate of internalParts) {
    suppressedNavigation.push({ title: candidate.title, pageIndex: candidate.pageIndex, confidence: candidate.confidence,
      evidence: [...candidate.evidence, 'confirmed chapter outline brackets this internal division'],
      reason: 'internal part heading within a chapter, absent from the book outline' });
  }
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
    anchor: blocks[candidate.blockIndex]?.anchor ?? makeSourceAnchor(candidate.pageIndex, pages[candidate.pageIndex]?.label, 0, 0, candidate.title),
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

export function matchingOutlineBlock(
  item: NonNullable<PDFExtractionResult['outlines']>[number],
  blocks: InternalBlock[],
  pages: PDFPageExtraction[],
): number {
  if (item.pageIndex < 0) return -1;
  // Publisher bookmarks often append the chapter author's name; it is printed
  // as a separate byline, not part of the heading's typography.
  const withoutByline = item.title.replace(/\s+\((?=[^()]*\p{L})[^()]+\)\s*$/u, '');
  const withoutOrdinal = withoutByline.replace(new RegExp(`^${EXPLICIT_NUMBER}\\s*[:.]\\s*`, 'iu'), '');
  for (let index = 0; index < blocks.length; index++) {
    const first = blocks[index]!;
    if (first.anchor.pageIndex !== item.pageIndex || first.kind !== 'heading') continue;
    let text = '';
    for (let next = index; next < Math.min(index + 6, blocks.length); next++) {
      const block = blocks[next]!;
      if (block.anchor.pageIndex !== item.pageIndex || block.kind !== 'heading') break;
      if (next > index && (Math.abs((block.fontSize ?? 0) - (first.fontSize ?? 0)) > 1
        || (block.bounds?.y ?? 0) - (blocks[next - 1]!.bounds?.y ?? 0) > (first.fontSize ?? 11) * 2.5)) break;
      text += (text ? ' ' : '') + block.text;
      const withoutFootnote = text.replace(/(?<=\p{L})\d{1,2}$/u, '');
      // PDF kerning can extract a heading as "V alue". Only tolerate this
      // when confirming a printed heading at the bookmark's exact page.
      const compact = (value: string) => normalizeKey(value).replace(/\s+/gu, '');
      if ([item.title, withoutByline, withoutOrdinal].some((title) => compact(title) === compact(withoutFootnote))) return index;
      if (Math.max(titleSimilarity(withoutFootnote, item.title), titleSimilarity(withoutFootnote, withoutByline),
        titleSimilarity(withoutFootnote, withoutOrdinal)) >= 0.84) return index;
    }
  }
  // Older native builds can supply text and bookmarks without font geometry.
  // In that case headings may have merged into prose blocks. Confirm the exact
  // title on the bookmark's destination using the original line boundaries;
  // don't relax the confidence gate or search arbitrary body-text substrings.
  const compact = (value: string) => normalizeKey(value).replace(/\s+/gu, '');
  const titles = new Set([item.title, withoutByline, withoutOrdinal].map(compact).filter(Boolean));
  const lines = [...(pages[item.pageIndex]?.text ?? '').matchAll(/[^\r\n]+/gu)]
    .filter((line) => line[0].trim());
  for (let start = 0; start < Math.min(8, lines.length); start++) {
    let text = '';
    for (let end = start; end < Math.min(start + 6, lines.length); end++) {
      text += (text ? ' ' : '') + lines[end]![0];
      if (!titles.has(compact(text.replace(/(?<=\p{L})\d{1,2}$/u, '')))) continue;
      const sourceStart = lines[start]!.index!;
      const sourceEnd = lines[end]!.index! + lines[end]![0].length;
      const blockIndex = blocks.findIndex((block) => block.anchor.pageIndex === item.pageIndex
        && block.anchor.sourceStart < sourceEnd && block.anchor.sourceEnd > sourceStart);
      if (blockIndex >= 0) return blockIndex;
    }
  }
  return -1;
}

export function expandedHeadingTitle(blocks: InternalBlock[], blockIndex: number, kind: SemanticSectionKind): string {
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

export function detectPageSections(blocks: InternalBlock[], pages: PDFPageExtraction[], bookTitle: string): SectionCandidate[] {
  const result: SectionCandidate[] = [];
  const tables = sourceTOCPages(pages.map(page => page.text));
  for (const page of pages.slice(0, Math.min(20, pages.length))) {
    const pageBlocks = blocks.map((block, index) => ({ block, index })).filter(({ block }) => block.anchor.pageIndex === page.index);
    const text = pageBlocks.map(({ block }) => block.text).join(' ');
    let kind: SemanticSectionKind | undefined;
    let title = '';
    let confidence = 0;
    let evidence: string[] = [];
    if (/\b(?:copyright|all rights reserved|ISBN|library of congress|creative commons|published by)\b|©/iu.test(text)) {
      kind = 'copyright'; title = 'Copyright'; confidence = 0.96; evidence = ['copyright and publication identifiers'];
    } else if (tables.has(page.index) && !/(?:^|\s)(?:table of )?contents(?:\s|$)/iu.test(text)) {
      kind = 'contents'; title = 'Contents'; confidence = 0.94; evidence = ['raw contents destinations and repeated leaders'];
    } else if (/(?:^|\s)(?:table of )?contents(?:\s|$)/iu.test(text) && (text.match(/\.{2,}|\s\d{1,4}\b/gu)?.length ?? 0) >= 2) {
      kind = 'contents'; title = 'Contents'; confidence = 0.94; evidence = ['contents label and page destinations'];
    } else if (/^(?:to|for)\s+.{2,120}$/iu.test(text.trim()) && pageBlocks.length <= 4) {
      kind = 'dedication'; title = 'Dedication'; confidence = 0.8; evidence = ['short isolated dedication phrase'];
    } else if (page.index <= 3 && titleSimilarity(text, bookTitle) >= 0.55 && pageBlocks.some(({ block }) => block.kind === 'heading')) {
      kind = 'titlePage'; title = 'Title page'; confidence = 0.86; evidence = ['book title in prominent opening typography'];
    } else if (page.index === 0 && pageBlocks.length > 3 && text.length < 600 && !/[.!?]/u.test(text)
      && /copyright|all rights reserved|©/iu.test(pages[1]?.text ?? '')) {
      kind = 'titlePage'; title = 'Title page'; confidence = 0.86; evidence = ['opening title typography before copyright page'];
    } else if (page.index === 0 && pageBlocks.length <= 3
      && !/^\p{Ll}/u.test(pages[1]?.text.trimStart() ?? '')) {
      kind = 'cover'; title = 'Cover'; confidence = 0.65; evidence = ['sparse first page'];
    }
    if (!kind || !pageBlocks.length) continue;
    result.push({ title, kind, pageIndex: page.index, blockIndex: pageBlocks[0]!.index, level: 0,
      confidence, evidence, source: 'page' });
  }
  return result;
}

export function parseTOCEntries(blocks: InternalBlock[]): Array<{ title: string; printedPage: number; pageIndex?: number }> {
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

export function dedupeCandidates(candidates: SectionCandidate[]): SectionCandidate[] {
  const result: SectionCandidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.blockIndex - b.blockIndex || b.confidence - a.confidence)) {
    const duplicate = result.find((item) => item.pageIndex === candidate.pageIndex
      && Math.abs(item.blockIndex - candidate.blockIndex) <= 1
      && (item.kind === candidate.kind || titleSimilarity(item.title, candidate.title) >= 0.72));
    if (!duplicate) result.push(candidate);
    else if (candidate.confidence > duplicate.confidence) Object.assign(duplicate, candidate);
    else duplicate.evidence = unique([...duplicate.evidence, ...candidate.evidence]);
  }
  return result;
}

export function enforceDocumentOrder(candidates: SectionCandidate[], suppressed: ParseDiagnostics['suppressedNavigation']): SectionCandidate[] {
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
    if (!isFront && !isBack && candidate.kind !== 'preface' && candidate.kind !== 'foreword') bodySeen = true;
    // Collected works legitimately place references, contributor notes, and
    // acknowledgments between chapters. Preserve the chronological candidates;
    // hierarchy and confidence decide navigation instead of a one-way back-matter flag.
    result.push(candidate);
  }
  return result;
}

export function firstBodyBlock(blocks: InternalBlock[], pages: PDFPageExtraction[]): number {
  const frontPages = new Set(detectPageSections(blocks, pages, '').filter((item) => FRONT_KINDS.has(item.kind)).map(({ pageIndex }) => pageIndex));
  const candidates = blocks.map((block, index) => ({ block, index })).filter(({ block }) => block.kind === 'prose' && !frontPages.has(block.anchor.pageIndex));
  const sustained = candidates.find(({ index }) => blocks.slice(index, index + 3).filter(({ kind }) => kind === 'prose').length >= 2);
  return sustained?.index ?? candidates[0]?.index ?? -1;
}

export function firstBlockOnOrAfterPage(blocks: InternalBlock[], pageIndex: number): number {
  const index = blocks.findIndex((block) => block.anchor.pageIndex >= pageIndex);
  return index < 0 ? Math.max(0, blocks.length - 1) : index;
}
