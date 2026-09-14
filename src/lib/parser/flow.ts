import type { InternalBlock } from './types';
import type { SectionNode, ReadingUnit, ContextualSupplement, ContentBlockKind, SemanticSectionKind, Chapter, ContentBlock } from '../../types';
import type { ReadingPassage, ReadingPassageSegment } from '../readingUnits';
import { PRIMARY_KINDS, COMPLETE_TEXT_KINDS, BODY_START_KINDS, FRONT_KINDS, BACK_KINDS } from './policy';

export function assignSections(blocks: InternalBlock[], sections: SectionNode[]): void {
  for (let index = 0; index < blocks.length; index++) {
    const section = [...sections].reverse().find((candidate) => candidate.startBlock <= index);
    if (section) blocks[index]!.sectionId = section.id;
    if (section?.kind === 'bibliography' || section?.kind === 'notes' || section?.kind === 'index') {
      if (blocks[index]!.kind === 'prose') blocks[index]!.kind = 'reference';
    }
  }
}

export function buildPassages(blocks: InternalBlock[], sections: SectionNode[]): ReadingPassage[] {
  const result: ReadingPassage[] = [];
  for (const section of sections) {
    if (!PRIMARY_KINDS.has(section.kind)) continue;
    const candidates = blocks.slice(section.startBlock, section.endBlock + 1)
      .filter((block) => block.sectionId === section.id && (block.kind === 'prose' || block.kind === 'reference'
        || COMPLETE_TEXT_KINDS.has(section.kind) && block.kind !== 'decorative'));
    if (!candidates.length) continue;
    let text = '';
    const segments: ReadingPassageSegment[] = [];
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

export function buildSupplements(blocks: InternalBlock[], sections: SectionNode[], units: ReadingUnit[]): ContextualSupplement[] {
  const secondary = new Set<ContentBlockKind>(['footnote', 'caption', 'table', 'reference']);
  const closestUnit = indexReadingUnits(units);
  return blocks.filter((block) => secondary.has(block.kind)).map((block, index) => {
    const section = sections.find(({ id }) => id === block.sectionId);
    const closest = closestUnit(block.anchor.pageIndex, section?.id);
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

export function attachSupplements(units: ReadingUnit[], supplements: ContextualSupplement[]): void {
  const byId = new Map(units.map(unit => [unit.id, unit]));
  for (const supplement of supplements) {
    const unitID = supplement.relatedBlockIds.find((id) => id.startsWith('unit-'));
    const unit = unitID ? byId.get(unitID) : undefined;
    if (unit) unit.supplementIds.push(supplement.id);
  }
}

export function finalizeSectionRanges(sections: SectionNode[], blocks: InternalBlock[], units: ReadingUnit[]): void {
  for (const section of sections) {
    const sectionUnits = units.map((unit, index) => ({ unit, index })).filter(({ unit }) => unit.sectionId === section.id);
    section.startUnit = sectionUnits[0]?.index ?? -1;
    section.endUnit = sectionUnits.at(-1)?.index ?? -1;
    const lastBlock = blocks[section.endBlock];
    if (lastBlock) section.endPage = Math.max(section.startPage, lastBlock.anchor.pageIndex);
  }
}

export function determineReadingStart(sections: SectionNode[], units: ReadingUnit[]): number {
  // Availability and the first-open destination are independent: optional
  // front/back matter stays readable without forcing a new reader through it.
  const section = sections.find((candidate) => BODY_START_KINDS.has(candidate.kind)
    && candidate.kind !== 'foreword' && candidate.kind !== 'preface' && candidate.startUnit >= 0)
    ?? sections.find((candidate) => BODY_START_KINDS.has(candidate.kind) && candidate.startUnit >= 0);
  return Math.max(0, section?.startUnit ?? (units.length ? 0 : -1));
}

export function legacyChapterKind(kind: SemanticSectionKind): Chapter['kind'] {
  if (FRONT_KINDS.has(kind)) return 'frontMatter';
  if (BACK_KINDS.has(kind)) return 'backMatter';
  if (kind === 'part') return 'part';
  if (kind === 'section') return 'section';
  return 'chapter';
}

export function indexReadingUnits(units: ReadingUnit[]): (pageIndex: number, sectionId?: string) => ReadingUnit | undefined {
  type Entry = { page: number; index: number; unit: ReadingUnit };
  const groups = new Map<string, Map<number, Entry>>();
  units.forEach((unit, index) => {
    for (const key of ['', ...(unit.sectionId ? [unit.sectionId] : [])]) {
      let pages = groups.get(key);
      if (!pages) { pages = new Map(); groups.set(key, pages); }
      for (const page of unit.sourcePages) if (!pages.has(page)) pages.set(page, { page, index, unit });
    }
  });
  const sorted = new Map([...groups].map(([key, pages]) => [key, [...pages.values()].sort((a, b) => a.page - b.page)]));
  return (pageIndex, sectionId) => {
    const entries = sorted.get(sectionId ?? '') ?? sorted.get('') ?? [];
    let low = 0, high = entries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (entries[middle]!.page < pageIndex) low = middle + 1;
      else high = middle;
    }
    const before = entries[low - 1], after = entries[low];
    if (!before) return after?.unit;
    if (!after) return before.unit;
    const difference = Math.abs(before.page - pageIndex) - Math.abs(after.page - pageIndex);
    return (difference < 0 || difference === 0 && before.index < after.index ? before : after).unit;
  };
}

export function stripInternalBlock(block: InternalBlock): ContentBlock {
  const { pageHeight: _pageHeight, pageWidth: _pageWidth, centered: _centered,
    bold: _bold, italic: _italic, ...publicBlock } = block;
  return publicBlock;
}
