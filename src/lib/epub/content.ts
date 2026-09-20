import { resolveReference } from './archive';
import { children, descendants, normalized, parseXML, semantics, type Element, type Node } from './xml';
import { semanticKind, type Destination, type SpineItem } from './package';
import { makeEpubAnchor } from '../readingUnits';
import type { ContentBlock, EPUBSourceAnchor, SemanticSectionKind } from '../../types';

export type EpubBlock = ContentBlock & { anchor: EPUBSourceAnchor; headingLevel?: number; semanticKind?: SemanticSectionKind; linear: boolean };
export type Region = { offset: number; end: number; kind: SemanticSectionKind; title?: string; depth: number };
export type EpubDocument = { item: SpineItem; blocks: EpubBlock[]; targets: Map<string, number>; references: Array<Destination & { offset: number }>; regions: Region[] };
const boundaries = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'blockquote', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'figure', 'pre', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const ignored = new Set(['script', 'style', 'head', 'template', 'audio', 'video', 'iframe', 'object']);
function hidden(element: Element): boolean {
  return element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true'
    || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/iu.test(element.getAttribute('style') ?? '');
}
function textTree(node: Node, depth = 0): string {
  if (depth > 256) throw new Error('This EPUB has excessively nested content.');
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? '';
  if (node.nodeType !== 1) return '';
  const element = node as Element, tag = (element.localName ?? element.tagName).toLowerCase();
  if (ignored.has(tag) || hidden(element) || semantics(element).some(type => type === 'backlink' || type === 'noteref')) return '';
  if (tag === 'img') return element.getAttribute('alt') ?? '';
  if (tag === 'br') return '\n';
  let text = '';
  for (let child = node.firstChild; child; child = child.nextSibling) text += textTree(child, depth + 1);
  if (tag === 'td' || tag === 'th') return text + ' | ';
  return boundaries.has(tag) || tag === 'tr' ? text + '\n' : text;
}

/** Walk text nodes once: inline tags never introduce spaces or duplicate prose. */
export function readContent(text: string, item: SpineItem): EpubDocument {
  const document = parseXML(text, item.path, true);
  const body = descendants(document, 'body')[0];
  if (!body) throw new Error(`This EPUB has no readable document body (${item.path}).`);
  const result: EpubDocument = { item, blocks: [], targets: new Map(), references: [], regions: [] };
  let cursor = 0;
  type Context = { kind: ContentBlock['kind']; semanticKind?: SemanticSectionKind; elementId?: string; headingLevel?: number };
  let pending = '', pendingContext: Context = { kind: 'prose' };
  let events: Array<{ raw: number; id?: string; reference?: Destination }> = [];
  const addBlock = (value: string, context: Context) => {
    const text = normalized(value);
    if (!text) return;
    const anchor = makeEpubAnchor({ documentPath: item.path, spineIndex: item.spineIndex, elementId: context.elementId, sourceStart: cursor, sourceEnd: cursor + text.length }, text);
    result.blocks.push({ id: `epub-block-${item.spineIndex}-${result.blocks.length}`, kind: context.kind, text, anchor,
      headingLevel: context.headingLevel, semanticKind: context.semanticKind, linear: item.linear,
      confidence: 1, evidence: ['EPUB XHTML document order and semantics'] });
    cursor += text.length + 1;
  };
  const flush = () => {
    const collapsed = pending.replace(/[\s\u00a0]+/gu, ' '), leading = collapsed.length - collapsed.trimStart().length;
    const length = normalized(pending).length;
    for (const event of events) {
      const prefix = pending.slice(0, event.raw).replace(/[\s\u00a0]+/gu, ' ').length;
      const offset = cursor + Math.max(0, Math.min(length, prefix - leading));
      if (event.id && !result.targets.has(event.id)) result.targets.set(event.id, offset);
      if (event.reference) result.references.push({ ...event.reference, offset });
    }
    addBlock(pending, pendingContext);
    pending = ''; events = [];
  };
  const append = (text: string, context: Context) => {
    if (!pending.trim()) pendingContext = context;
    pending += text;
  };
  const walk = (element: Element, inherited: Context, depth: number) => {
    if (depth > 256) throw new Error('This EPUB has excessively nested content.');
    const tag = (element.localName ?? element.tagName).toLowerCase(), types = semantics(element);
    if (ignored.has(tag) || hidden(element)) return;
    const heading = /^h[1-6]$/u.test(tag), boundary = boundaries.has(tag);
    const note = types.some(type => ['footnote', 'endnote', 'rearnote'].includes(type));
    const atomic = note || tag === 'table' || tag === 'figcaption' || tag === 'caption' || tag === 'img' || tag === 'svg';
    if (boundary || atomic) flush();
    const id = element.getAttribute('id') || element.getAttribute('xml:id') || undefined;
    if (id) events.push({ raw: pending.length, id });
    // Gutenberg marks its license/header wrappers with a stable publisher
    // class rather than epub:type. Keep them readable as optional material.
    const publisherBoilerplate = (element.getAttribute('class') ?? '').split(/\s/u).includes('pg-boilerplate');
    const ownKind = semanticKind(types) ?? (publisherBoilerplate && tag === 'header' ? 'copyright'
      : publisherBoilerplate && tag === 'footer' ? 'colophon' : undefined);
    const context: Context = { ...inherited, elementId: id ?? inherited.elementId,
      semanticKind: ownKind ?? inherited.semanticKind, kind: heading ? 'heading' : inherited.kind,
      headingLevel: heading ? Number(tag[1]) - 1 : inherited.headingLevel };
    const region: Region | undefined = ownKind ? { offset: cursor, end: cursor, kind: ownKind, depth,
      title: normalized(children(element).find(child => /^h[1-6]$/u.test(child.localName ?? ''))?.textContent ?? '').slice(0, 180) } : undefined;
    if (region) result.regions.push(region);
    const legacyNoteReference = tag === 'a' && (element.getAttribute('href') ?? '').includes('#')
      && /^[\dA-Za-z*†‡]{1,5}$/u.test(normalized(element.textContent ?? ''))
      && ((element.parentNode as Element | null)?.localName === 'sup' || children(element).some(child => child.localName === 'sup'));
    if (types.includes('noteref') || legacyNoteReference) {
      const href = element.getAttribute('href');
      const reference = href ? resolveReference(item.path, href) : null;
      if (reference) events.push({ raw: pending.length, reference });
      // The reference marker belongs to the context control, not sentence text.
    } else if (types.includes('backlink')) {
      // Navigation back to a note reference is not readable prose.
    } else if (atomic) {
      for (const child of descendants(element)) {
        const childId = child.getAttribute('id');
        if (childId) events.push({ raw: 0, id: childId });
      }
      const alternative = tag === 'img' ? element.getAttribute('alt') ?? '' : tag === 'svg'
        ? normalized([descendants(element, 'title')[0]?.textContent, descendants(element, 'desc')[0]?.textContent].filter(Boolean).join(' ')) : textTree(element);
      pendingContext = { ...context, kind: note ? 'footnote' : tag === 'table' ? 'table' : 'caption' };
      pending = alternative;
      flush();
    } else {
      for (let child = element.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3 || child.nodeType === 4) append(child.nodeValue ?? '', context);
        else if (child.nodeType === 1) {
          if ((child as Element).localName === 'br') append('\n', context);
          else walk(child as Element, context, depth + 1);
        }
      }
    }
    if (boundary) flush();
    if (region) region.end = cursor;
  };
  walk(body, { kind: 'prose' }, 0);
  flush();
  return result;
}
