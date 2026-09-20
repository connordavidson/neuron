import { DOMParser, type Document, type Element, type Node } from '@xmldom/xmldom';
export type { Document, Element, Node } from '@xmldom/xmldom';
export const OPF = 'http://www.idpf.org/2007/opf';
export const EPUB = 'http://www.idpf.org/2007/ops';
export const XHTML = 'http://www.w3.org/1999/xhtml';

export function parseXML(text: string, path: string, xhtml = false): Document {
  // Standard EPUB 2 XHTML doctypes are allowed, but no custom entity declarations
  // or external entity resolution. The DOM is data only, never rendered/executed.
  if (/<!ENTITY\s|<!DOCTYPE[^>]*\[/iu.test(text)) throw new Error(`This EPUB contains unsupported XML entities (${path}).`);
  try {
    const document = new DOMParser({ onError: level => { if (level !== 'warning') throw new Error('Invalid XML'); } })
      .parseFromString(text, xhtml ? 'application/xhtml+xml' : 'application/xml');
    if (!document.documentElement) throw new Error('Empty XML');
    return document;
  } catch { throw new Error(`This EPUB contains an unreadable document (${path}).`); }
}

export function children(node: Node): Element[] {
  const result: Element[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) result.push(child as Element);
  return result;
}
export function descendants(node: Node, name?: string, namespace?: string): Element[] {
  const result: Element[] = [], stack = children(node).reverse();
  while (stack.length) {
    const element = stack.pop()!;
    if ((!name || element.localName === name) && (!namespace || element.namespaceURI === namespace)) result.push(element);
    const nested = children(element);
    for (let index = nested.length - 1; index >= 0; index--) stack.push(nested[index]!);
  }
  return result;
}
export const normalized = (text: string): string => text.replace(/[\s\u00a0]+/gu, ' ').trim();
export const textOf = (node: Node | undefined): string => normalized(node?.textContent ?? '');
export const tokens = (value: string | null): string[] => (value ?? '').trim().split(/\s+/u).filter(Boolean);
export const semantics = (element: Element): string[] => [...tokens(element.getAttributeNS(EPUB, 'type')), ...tokens(element.getAttribute('role')).map(role => role.replace(/^doc-/u, ''))];
