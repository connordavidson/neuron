import type { ContentBlock, ReadingUnit, SectionNode, SourceAnchor } from '../types';
import { sentenceSpans } from './sentences';

export type ReadingPassageSegment = {
  start: number;
  end: number;
  block: Pick<ContentBlock, 'anchor'>;
};

export type ReadingPassage = {
  section: Pick<SectionNode, 'id' | 'title'>;
  text: string;
  segments: ReadingPassageSegment[];
};

export async function proposedSentenceBoundaries(
  texts: string[],
  tokenize?: (texts: string[]) => Promise<number[][]>,
): Promise<number[][]> {
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

export function generateReadingUnits(passages: ReadingPassage[], proposals: number[][]): ReadingUnit[] {
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
  return makeSourceAnchor(pageIndex, undefined, 0, text.length, text);
}

export function makeSourceAnchor(
  pageIndex: number,
  pageLabel: string | undefined,
  sourceStart: number,
  sourceEnd: number,
  context: string,
): SourceAnchor {
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

function segmentAt(segments: ReadingPassageSegment[], offset: number): ReadingPassageSegment {
  return segments.find((segment) => offset >= segment.start && offset < segment.end)
    ?? segments.findLast((segment) => segment.start <= offset)
    ?? segments[0]!;
}

function anchorWithinSegment(segment: ReadingPassageSegment, relativeOffset: number, context: string): SourceAnchor {
  const blockLength = Math.max(1, segment.end - segment.start);
  const sourceLength = Math.max(0, segment.block.anchor.sourceEnd - segment.block.anchor.sourceStart);
  const sourceOffset = Math.min(sourceLength, Math.max(0, Math.round(relativeOffset / blockLength * sourceLength)));
  const sourceStart = segment.block.anchor.sourceStart + sourceOffset;
  return makeSourceAnchor(
    segment.block.anchor.pageIndex,
    segment.block.anchor.pageLabel,
    sourceStart,
    sourceStart + Math.min(context.length, Math.max(0, sourceLength - sourceOffset)),
    context,
  );
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

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
