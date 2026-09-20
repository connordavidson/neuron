import { EpubArchive, bytesSource, type ByteSource } from './archive';
import { readPublication, semanticKind, type Destination, type Navigation } from './package';
import { readContent, type EpubDocument, type EpubBlock } from './content';
import { generateReadingUnits, proposedSentenceBoundaries, type ReadingPassage } from '../readingUnits';
import { classifySectionTitle, COMPLETE_TEXT_KINDS, BODY_START_KINDS, PROGRESS_EXCLUDED_KINDS } from '../parser/policy';
import { legacyChapterKind } from '../parser/flow';
import type { ParsedEbook, SentenceTokenizer } from '../contentParser';
import type { Chapter, ContextualSupplement, ReadingUnit, SectionNode, SemanticSectionKind } from '../../types';

export const EPUB_PARSER_VERSION = 2;
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
type Boundary = { block: number; title: string; kind: SemanticSectionKind; level: number; evidence: string };

export async function parseEpub(source: ByteSource | Uint8Array | EpubArchive, filename: string, tokenize?: SentenceTokenizer): Promise<ParsedEbook> {
  const archive = source instanceof EpubArchive ? source : new EpubArchive(source instanceof Uint8Array ? bytesSource(source) : source);
  const publication = await readPublication(archive, filename);
  const documents: EpubDocument[] = [];
  const byPath = new Map<string, EpubDocument>();
  const ordered = [...publication.spine.filter(item => item.linear), ...publication.spine.filter(item => !item.linear)];
  for (const item of ordered) {
    const document = readContent(await archive.readText(item.path), item);
    documents.push(document);
    if (!byPath.has(item.path)) byPath.set(item.path, document);
    await pause();
  }
  // Some otherwise usable books keep referenced endnotes outside the spine.
  // Retain those as optional reading material without changing primary order.
  for (let index = 0; index < documents.length; index++) {
    for (const reference of documents[index]!.references) {
      if (byPath.has(reference.path)) continue;
      const resource = [...publication.resources.values()].find(item => item.path === reference.path);
      if (!resource || !archive.has(reference.path) || !['application/xhtml+xml', 'text/html'].includes(resource.mediaType)) continue;
      const document = readContent(await archive.readText(resource.path), { ...resource, spineIndex: publication.spine.length + documents.length, linear: false });
      documents.push(document); byPath.set(resource.path, document);
      await pause();
    }
  }
  const blocks = documents.flatMap(document => document.blocks);
  const blockIndices = new Map(blocks.map((block, index) => [block.id, index]));
  function destinationIndex(destination: Destination): number | undefined {
    const document = byPath.get(destination.path);
    if (!document?.blocks.length) return undefined;
    const offset = destination.fragment ? document.targets.get(destination.fragment) : 0;
    if (offset == null) return undefined;
    const block = document.blocks.find(block => block.anchor.sourceEnd > offset || block.anchor.sourceStart >= offset);
    return block ? blockIndices.get(block.id) : undefined;
  }
  function navigationIndex(node: Navigation): number | undefined {
    const own = node.destination && destinationIndex(node.destination);
    return own ?? node.children.map(navigationIndex).find(index => index != null);
  }
  function kindAt(index: number): SemanticSectionKind | undefined {
    return blocks[index]?.semanticKind;
  }
  const boundaries: Boundary[] = [];
  function addNavigation(nodes: Navigation[]) {
    for (const node of nodes) {
      const index = navigationIndex(node);
      if (index != null && node.title) {
        const inherited = kindAt(index);
        const kind = node.children.length ? classifySectionTitle(node.title)?.kind ?? 'part'
          : inherited && !['body', 'unknownFront', 'unknownBack'].includes(inherited) ? inherited
          : classifySectionTitle(node.title)?.kind ?? (inherited === 'unknownFront' || inherited === 'unknownBack' ? inherited : node.level === 0 ? 'chapter' : 'section');
        boundaries.push({ block: index, title: node.title, kind, level: node.level, evidence: 'resolved EPUB navigation destination' });
      }
      addNavigation(node.children);
    }
  }
  addNavigation(publication.navigation);
  // Semantic regions and headings add destinations not represented by the TOC.
  // No default file boundary is inserted inside an already identified chapter.
  for (const document of documents) {
    for (const region of document.regions) {
      const block = document.blocks.find(block => block.anchor.sourceEnd > region.offset);
      const index = block && blockIndices.get(block.id);
      if (!block || index == null || boundaries.some(boundary => boundary.block === index) || ['body', 'unknownFront', 'unknownBack'].includes(region.kind)) continue;
      boundaries.push({ block: index, title: block.kind === 'heading' ? block.text : sectionLabel(region.kind), kind: region.kind,
        level: region.kind === 'part' ? 0 : 1, evidence: 'EPUB structural semantics' });
    }
    for (const block of document.blocks) {
      const index = blockIndices.get(block.id)!;
      if (block.kind !== 'heading' || boundaries.some(boundary => boundary.block === index)) continue;
      if (block.semanticKind && COMPLETE_TEXT_KINDS.has(block.semanticKind)
        && boundaries.some(boundary => boundary.block < index && blocks[boundary.block]?.anchor.documentPath === document.item.path)) continue;
      const kind = classifySectionTitle(block.text)?.kind ?? (block.semanticKind && PROGRESS_EXCLUDED_KINDS.has(block.semanticKind) ? block.semanticKind
        : (block.headingLevel ?? 0) === 0 ? 'chapter' : 'section');
      boundaries.push({ block: index, title: block.text, kind, level: block.headingLevel ?? 0, evidence: 'XHTML heading' });
    }
    for (const landmark of publication.landmarks.filter(landmark => landmark.path === document.item.path)) {
      const index = destinationIndex(landmark), kind = semanticKind([landmark.type]);
      if (index == null || !kind) continue;
      const existing = boundaries.filter(boundary => boundary.block === index).at(-1);
      if (existing) { if (existing.kind === 'chapter' || existing.kind === 'section' || existing.kind === 'body') existing.kind = kind === 'body' ? existing.kind : kind; }
      else boundaries.push({ block: index, title: sectionLabel(kind), kind, level: 0, evidence: 'EPUB landmark' });
    }
    const first = document.blocks[0], index = first && blockIndices.get(first.id);
    if (!first || index == null || boundaries.some(boundary => boundary.block === index)) continue;
    const previous = [...boundaries].filter(boundary => boundary.block < index).sort((a, b) => b.block - a.block)[0];
    const beforeFirstBoundary = boundaries.some(boundary => boundary.block > index && blocks[boundary.block]?.anchor.documentPath === document.item.path);
    const inherited = first.semanticKind;
    if (!previous || beforeFirstBoundary || previous && blocks[previous.block]!.linear !== first.linear
      || inherited && inherited !== kindAt(previous.block) || !first.linear) {
      const kind = inherited ?? (first.linear ? 'body' : 'unknownBack');
      boundaries.push({ block: index, title: inherited ? sectionLabel(kind) : first.linear ? publication.metadata.title.value : 'Additional material', kind, level: 0, evidence: 'readable EPUB spine content' });
    }
  }
  const unique = boundaries.filter((boundary, index) => !boundaries.slice(0, index).some(other => other.block === boundary.block && other.title === boundary.title));
  unique.sort((a, b) => a.block - b.block || a.level - b.level);
  const titleKey = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const bookTitleKey = titleKey(publication.metadata.title.value);
  unique.forEach((boundary, index) => {
    const block = blocks[boundary.block]!, label = titleKey(boundary.title);
    const openingTitle = block.kind === 'heading' && block.anchor.spineIndex < 3 && !block.semanticKind
      && label.length >= 7 && bookTitleKey.includes(label) && ['chapter', 'section'].includes(boundary.kind);
    if (openingTitle && blocks.slice(boundary.block, unique[index + 1]?.block ?? blocks.length)
      .reduce((words, item) => words + item.text.split(/\s/u).length, 0) < 80) {
      boundary.kind = 'titlePage'; boundary.evidence = 'sparse opening heading matching EPUB title metadata';
    }
  });
  const sections: SectionNode[] = unique.map((boundary, index) => ({
    id: `epub-section-${index}`, title: boundary.title, kind: boundary.kind, level: boundary.level,
    startBlock: boundary.block, endBlock: (unique[index + 1]?.block ?? blocks.length) - 1,
    startUnit: -1, endUnit: -1, anchor: blocks[boundary.block]!.anchor, linear: blocks[boundary.block]!.linear,
    confidence: 1, evidence: [boundary.evidence],
  }));
  const stack: SectionNode[] = [];
  for (const section of sections) {
    while (stack.length && stack.at(-1)!.level >= section.level) stack.pop();
    if (stack.length) section.parentId = stack.at(-1)!.id;
    stack.push(section);
    for (let index = section.startBlock; index <= section.endBlock; index++) blocks[index]!.sectionId = section.id;
  }
  const passages: ReadingPassage[] = [];
  for (const section of sections) {
    const primary = blocks.slice(section.startBlock, section.endBlock + 1).filter(block => block.kind === 'prose'
      || COMPLETE_TEXT_KINDS.has(section.kind) && block.kind !== 'decorative');
    if (!primary.length) continue;
    const passage: ReadingPassage = { section, text: '', segments: [] };
    for (const block of primary) {
      if (passage.text) passage.text += ' ';
      const start = passage.text.length;
      passage.text += block.text;
      passage.segments.push({ start, end: passage.text.length, block });
    }
    passages.push(passage);
  }
  const proposals: number[][] = [];
  for (let index = 0; index < passages.length; index += 16) {
    proposals.push(...await proposedSentenceBoundaries(passages.slice(index, index + 16).map(passage => passage.text), tokenize));
    await pause();
  }
  const readingUnits = generateReadingUnits(passages, proposals);
  if (!readingUnits.some(unit => blocks.some(block => block.sectionId === unit.sectionId && block.kind === 'prose'))) {
    throw new Error('This EPUB has no readable text. Import a text-focused, reflowable edition.');
  }
  const sectionMap = new Map(sections.map(section => [section.id, section]));
  readingUnits.forEach((unit, index) => {
    let section = unit.sectionId ? sectionMap.get(unit.sectionId) : undefined;
    while (section) {
      if (section.startUnit < 0) section.startUnit = index;
      section.endUnit = index;
      section = section.parentId ? sectionMap.get(section.parentId) : undefined;
    }
  });
  const chapters: Chapter[] = sections.filter(section => section.startUnit >= 0).map(section => ({
    paragraphIndex: section.startUnit, title: section.title, level: section.level, kind: legacyChapterKind(section.kind), sectionId: section.id, confidence: section.confidence,
  })).sort((a, b) => a.paragraphIndex - b.paragraphIndex || (a.level ?? 0) - (b.level ?? 0));
  const supplements = makeSupplements(blocks, documents, readingUnits, destinationIndex, publication.warnings);
  const bodyLandmark = publication.landmarks.find(landmark => ['bodymatter', 'text'].includes(landmark.type));
  const bodyIndex = bodyLandmark && destinationIndex(bodyLandmark);
  const landmarkSection = bodyIndex == null ? undefined : [...sections].reverse().find(section => section.startBlock <= bodyIndex && section.endBlock >= bodyIndex);
  const eligible = sections.filter(section => section.linear !== false && section.startUnit >= 0);
  const firstBody = eligible.find(section => BODY_START_KINDS.has(section.kind) && !['foreword', 'preface'].includes(section.kind));
  const designated = landmarkSection?.linear !== false && landmarkSection && landmarkSection.startUnit >= 0 ? landmarkSection : undefined;
  const intro = eligible.find(section => section.kind === 'introduction' && section.startUnit <= (designated?.startUnit ?? firstBody?.startUnit ?? 0));
  const start = intro ?? designated ?? firstBody
    ?? eligible.find(section => BODY_START_KINDS.has(section.kind)) ?? eligible[0];
  return {
    metadata: publication.metadata, sections, blocks: blocks.map(({ headingLevel: _heading, semanticKind: _kind, linear: _linear, ...block }) => block),
    readingUnits, supplements, chapters, paragraphs: readingUnits.map(unit => unit.text), readingStart: Math.max(0, start?.startUnit ?? 0),
    diagnostics: { parserVersion: EPUB_PARSER_VERSION, warnings: publication.warnings, suppressedNavigation: [], counts: {
      sourcePages: 0, sourceSpans: 0, blocks: blocks.length, readingUnits: readingUnits.length, supplements: supplements.length, sections: sections.length, removedFurniture: 0,
    } },
  };
}

function sectionLabel(kind: SemanticSectionKind): string {
  const labels: Partial<Record<SemanticSectionKind, string>> = { titlePage: 'Title page', unknownFront: 'Front matter', unknownBack: 'Additional material', body: 'Start reading', aboutAuthor: 'About the author' };
  return labels[kind] ?? kind[0]!.toUpperCase() + kind.slice(1);
}

function makeSupplements(blocks: EpubBlock[], documents: EpubDocument[], units: ReadingUnit[], destinationIndex: (destination: Destination) => number | undefined, warnings: string[]): ContextualSupplement[] {
  const supplements: ContextualSupplement[] = [];
  const byBlock = new Map<string, ContextualSupplement>();
  const matchingUnit = (path: string, offset: number) => units.find(unit => unit.sentences.some(sentence => {
    const start = sentence.anchor, end = sentence.endAnchor;
    return start.format === 'epub' && end.format === 'epub'
      && (start.documentPath === path && start.sourceStart <= offset && (end.documentPath !== path || end.sourceStart >= offset)
        || end.documentPath === path && end.sourceStart >= offset && start.documentPath !== path);
  }));
  for (const block of blocks) {
    if (!['footnote', 'caption', 'table', 'reference'].includes(block.kind)) continue;
    const supplement: ContextualSupplement = { id: `epub-supplement-${supplements.length}`, kind: block.kind as ContextualSupplement['kind'],
      text: block.text, anchor: block.anchor, relatedBlockIds: [block.id], confidence: 1, evidence: ['EPUB contextual content'] };
    supplements.push(supplement); byBlock.set(block.id, supplement);
  }
  const attach = (supplement: ContextualSupplement, unit: ReadingUnit | undefined) => {
    if (!unit || unit.supplementIds.includes(supplement.id)) return;
    unit.supplementIds.push(supplement.id); supplement.relatedBlockIds.push(unit.id);
    supplement.readingPage ??= units.indexOf(unit) + 1;
  };
  for (const document of documents) for (const reference of document.references) {
    const targetIndex = destinationIndex(reference), target = targetIndex == null ? undefined : blocks[targetIndex];
    let supplement = target && byBlock.get(target.id);
    if (!supplement && target && target.kind === 'prose') {
      supplement = { id: `epub-supplement-${supplements.length}`, kind: 'footnote', text: target.text, anchor: target.anchor,
        relatedBlockIds: [target.id], confidence: 1, evidence: ['EPUB note-reference destination'] };
      supplements.push(supplement); byBlock.set(target.id, supplement);
    }
    if (supplement) attach(supplement, matchingUnit(document.item.path, Math.max(0, reference.offset - 1)));
    else warnings.push('A footnote reference has no readable local target.');
  }
  for (const supplement of supplements) {
    if (supplement.relatedBlockIds.some(id => id.startsWith('unit-'))) continue;
    const anchor = supplement.anchor;
    if (anchor.format !== 'epub') continue;
    const candidates = units.filter(unit => unit.anchor.format === 'epub' && unit.anchor.documentPath === anchor.documentPath);
    const closest = candidates.sort((a, b) => Math.abs(a.anchor.sourceStart - anchor.sourceStart) - Math.abs(b.anchor.sourceStart - anchor.sourceStart))[0];
    attach(supplement, closest ?? units.find(unit => unit.sectionId === blocks.find(block => block.id === supplement.relatedBlockIds[0])?.sectionId) ?? units[0]);
  }
  return supplements;
}
