import type { PDFTextSpan } from '../../../modules/pdf-text-extractor/src/PDFTextExtractor.types';
import type { SourceRect } from '../../types';

export function titleSimilarity(a: string, b: string): number {
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

export function isPlausibleTitle(value: string): boolean {
  const text = cleanLine(value);
  if (text.length < 3 || text.length > 180 || /^(?:untitled|unknown|document|ebook|book)$/iu.test(text)) return false;
  if (/^(?:copyright|contents|table of contents|isbn|published by|chapter|part)\b/iu.test(text)) return false;
  if (/\.(?:pdf|indd|docx?|ps|eps)$|^(?:microsoft word|untitled[-\s\d]|\d{5,}[_-])/iu.test(text)) return false;
  return text.split(/\s+/u).length <= 28 && !/\.\s|\.$/u.test(text);
}

export function furnitureKey(value: string): string {
  return normalizeKey(value)
    .replace(/\b(?:page\s+)?\d+(?:\s+(?:of|\/)\s+\d+)?\b/gu, '#')
    .replace(/\b[ivxlcdm]+\b/giu, '#')
    .trim();
}

export function normalizeKey(value: string): string {
  return cleanLine(value).normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function cleanHeading(value: string): string {
  return cleanLine(value).replace(/\s+[.·…]{2,}\s*\d+\s*$/u, '').replace(/[\s:;,.]+$/u, '');
}

export function cleanLine(value: string): string {
  return value.replace(/[\u00ad\uFEFF\u200B]/gu, '').replace(/[\u0000\u0008\uFFFD]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export function joinSpans(spans: PDFTextSpan[]): string {
  let result = '';
  let previous: PDFTextSpan | undefined;
  for (const span of spans) {
    const gap = previous ? span.bounds.x - previous.bounds.x - previous.bounds.width : 0;
    if (result && (span.sourceStart > (previous?.sourceEnd ?? 0) || gap > Math.min(span.fontSize, previous?.fontSize ?? span.fontSize) * 0.15)
      && !/\s$/u.test(result) && !/^\s|^[,.;:!?)}\]]/u.test(span.text)) result += ' ';
    result += span.text;
    previous = span;
  }
  return result;
}

export function joinPDFLines(lines: string[]): string {
  let result = '';
  for (const line of lines) {
    const next = cleanLine(line);
    if (!next) continue;
    if (result.endsWith('-') && /^\p{Ll}/u.test(next)) result = result.slice(0, -1) + next;
    else result += (result ? ' ' : '') + next;
  }
  return result;
}

export function looksTabular(text: string): boolean {
  return (text.match(/\s{2,}/gu)?.length ?? 0) >= 2 || (text.match(/\|/gu)?.length ?? 0) >= 2
    || /^(?:\S+\s+){0,2}\d+(?:[.,]\d+)?(?:\s+\d+(?:[.,]\d+)?){2,}$/u.test(text);
}

export function isPageNumberLine(text: string): boolean {
  return /^(?:page\s+)?(?:\d{1,5}|[ivxlcdm]{1,12})(?:\s+(?:of|\/)\s+\d{1,5})?$/iu.test(cleanLine(text));
}

export function unionRects(rects: SourceRect[]): SourceRect {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...rects.map(({ x }) => x));
  const top = Math.min(...rects.map(({ y }) => y));
  const right = Math.max(...rects.map(({ x, width }) => x + width));
  const bottom = Math.max(...rects.map(({ y, height }) => y + height));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function groupBy<T, K>(values: T[], key: (value: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  values.forEach((value) => result.set(key(value), [...(result.get(key(value)) ?? []), value]));
  return result;
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => { const identity = key(value); if (seen.has(identity)) return false; seen.add(identity); return true; });
}

export function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value! : fallback;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function stripExtension(value: string): string {
  return value.replace(/\.[^.]+$/u, '');
}
