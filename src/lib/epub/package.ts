import { EpubArchive, resolveReference } from './archive';
import { OPF, children, descendants, parseXML, semantics, textOf, tokens, type Element } from './xml';
import type { BookMetadata, SemanticSectionKind } from '../../types';

export type Resource = { id: string; path: string; mediaType: string; properties: string[]; fallback?: string };
export type SpineItem = Resource & { spineIndex: number; linear: boolean };
export type Destination = { path: string; fragment?: string };
export type Navigation = { title: string; destination?: Destination; level: number; children: Navigation[] };
export type Landmark = Destination & { type: string };
export type Publication = { metadata: BookMetadata; spine: SpineItem[]; resources: Map<string, Resource>; navigation: Navigation[]; landmarks: Landmark[]; warnings: string[] };
const value = (value: string) => ({ value, confidence: 1, evidence: ['EPUB package metadata'] });

export async function readPublication(archive: EpubArchive, filename: string): Promise<Publication> {
  if (await archive.readText('mimetype') !== 'application/epub+zip') throw new Error('This ZIP file is not an EPUB book.');
  const container = parseXML(await archive.readText('META-INF/container.xml'), 'META-INF/container.xml');
  const root = descendants(container, 'rootfile').find(item => item.getAttribute('media-type') === 'application/oebps-package+xml');
  const packageRef = root?.getAttribute('full-path');
  const packagePath = packageRef && resolveReference('', packageRef)?.path;
  if (!packagePath) throw new Error('This EPUB has no package document.');
  const document = parseXML(await archive.readText(packagePath), packagePath);
  const pkg = document.documentElement!;
  if (pkg.localName !== 'package' || pkg.namespaceURI !== OPF || !/^[23](?:\.|$)/u.test(pkg.getAttribute('version') ?? '')) throw new Error('This EPUB version is not supported.');
  const metadataElement = children(pkg).find(node => node.localName === 'metadata');
  const dc = (name: string) => metadataElement ? descendants(metadataElement, name, 'http://purl.org/dc/elements/1.1/') : [];
  const title = textOf(dc('title')[0]);
  const metadata: BookMetadata = {
    title: title ? value(title) : { value: filename.replace(/\.[^.]+$/u, '') || 'Imported book', confidence: 0.5, evidence: ['original filename'] },
    authors: dc('creator').map(item => value(textOf(item))).filter(item => item.value),
    identifiers: dc('identifier').map(item => ({ ...value(textOf(item)), scheme: /isbn/iu.test(item.getAttributeNS(OPF, 'scheme') ?? '') || /^(?:urn:)?isbn:/iu.test(textOf(item)) ? 'isbn' : /^doi:|10\.\d+\//iu.test(textOf(item)) ? 'doi' : 'other' })),
  };
  for (const key of ['publisher', 'language'] as const) if (textOf(dc(key)[0])) metadata[key] = value(textOf(dc(key)[0]));
  const metas = metadataElement ? descendants(metadataElement, 'meta') : [];
  const fixed = metas.some(item => item.getAttribute('property') === 'rendition:layout' && textOf(item) === 'pre-paginated'
    || item.getAttribute('name') === 'fixed-layout' && item.getAttribute('content') === 'true');
  const manifest = children(pkg).find(item => item.localName === 'manifest');
  const spineElement = children(pkg).find(item => item.localName === 'spine');
  if (!manifest || !spineElement) throw new Error('This EPUB is missing its reading order.');
  const resources = new Map<string, Resource>();
  for (const item of children(manifest).filter(item => item.localName === 'item')) {
    const id = item.getAttribute('id') ?? '', href = item.getAttribute('href');
    if (!id || !href || resources.has(id)) throw new Error('This EPUB has an invalid resource manifest.');
    const reference = resolveReference(packagePath, href);
    resources.set(id, { id, path: reference?.path ?? '', mediaType: item.getAttribute('media-type') ?? '', properties: tokens(item.getAttribute('properties')), fallback: item.getAttribute('fallback') ?? undefined });
  }
  const warnings: string[] = [], landmarks: Landmark[] = [];
  const ebookLib = metas.some(item => item.getAttribute('name') === 'generator' && /^Ebook-lib(?:\s|$)/iu.test(item.getAttribute('content') ?? ''));
  const spineItems = children(spineElement).filter(item => item.localName === 'itemref');
  const spine = spineItems.flatMap((item, spineIndex): SpineItem[] => {
    const idref = item.getAttribute('idref') ?? '';
    let resource = resources.get(idref);
    // Some EbookLib exports leave an undeclared "cover" before the navigation
    // document even though no cover was generated. Recover only that specific
    // leading placeholder; declared documents and all body references are required.
    const nextResource = resources.get(spineItems[spineIndex + 1]?.getAttribute('idref') ?? '');
    if (!resource && ebookLib && spineIndex === 0 && idref === 'cover' && !fixed
      && !item.getAttribute('properties') && nextResource?.properties.includes('nav')) {
      warnings.push('Skipped a missing optional cover placeholder in an EbookLib publication.');
      return [];
    }
    const seen = new Set<string>();
    while (resource && resource.mediaType !== 'application/xhtml+xml' && resource.mediaType !== 'text/html' && resource.fallback) {
      if (seen.has(resource.id)) throw new Error('This EPUB has a circular content fallback.');
      seen.add(resource.id); resource = resources.get(resource.fallback);
    }
    if (!resource) throw new Error(`This EPUB is missing required reading content: the reading-order entry "${idref || 'unnamed'}" has no document in its manifest.`);
    if (!resource.path) throw new Error('This EPUB requires remote reading content, which is not supported. Import an edition that includes its text in the file.');
    if (!archive.has(resource.path)) throw new Error(`This EPUB is missing required reading content (${resource.path}). Try another copy of the book.`);
    const properties = tokens(item.getAttribute('properties'));
    const prePaginated = properties.includes('rendition:layout-pre-paginated') || fixed && !properties.includes('rendition:layout-reflowable');
    if (prePaginated) throw new Error('Fixed-layout EPUBs are not supported yet. Import a reflowable edition.');
    if (!['application/xhtml+xml', 'text/html'].includes(resource.mediaType)) throw new Error('This EPUB contains unsupported reading content. Import a text-focused, reflowable edition.');
    return [{ ...resource, spineIndex, linear: item.getAttribute('linear') !== 'no' }];
  });
  if (!spine.length) throw new Error('This EPUB has no reading content.');
  let navigation: Navigation[] = [];
  const nav = [...resources.values()].find(item => item.properties.includes('nav'));
  if (nav?.path && archive.has(nav.path)) {
    const navigationText = await archive.readText(nav.path);
    try {
      const document = parseXML(navigationText, nav.path, true);
      for (const node of descendants(document, 'nav')) {
        if (semantics(node).includes('toc')) navigation = parseNavList(children(node).find(item => item.localName === 'ol'), nav.path);
        if (semantics(node).includes('landmarks')) for (const link of descendants(node, 'a')) {
          const ref = optionalReference(nav.path, link.getAttribute('href'));
          if (ref) for (const type of semantics(link)) landmarks.push({ ...ref, type });
        }
      }
    } catch { warnings.push('EPUB navigation could not be read; using content headings.'); }
  }
  if (!navigation.length) {
    const ncx = resources.get(spineElement.getAttribute('toc') ?? '') ?? [...resources.values()].find(item => item.mediaType === 'application/x-dtbncx+xml');
    if (ncx?.path && archive.has(ncx.path)) {
      const navigationText = await archive.readText(ncx.path);
      try {
        const document = parseXML(navigationText, ncx.path);
        navigation = parseNCX(descendants(document, 'navMap')[0], ncx.path);
      } catch { warnings.push('Legacy navigation could not be read; using content headings.'); }
    }
  }
  const guide = children(pkg).find(item => item.localName === 'guide');
  if (guide) for (const item of children(guide)) {
    const reference = optionalReference(packagePath, item.getAttribute('href'));
    if (reference) landmarks.push({ ...reference, type: item.getAttribute('type') ?? '' });
  }
  if (archive.has('META-INF/encryption.xml')) {
    const encryption = parseXML(await archive.readText('META-INF/encryption.xml'), 'META-INF/encryption.xml');
    for (const encrypted of descendants(encryption, 'EncryptedData')) {
      const algorithm = descendants(encrypted, 'EncryptionMethod')[0]?.getAttribute('Algorithm');
      const uri = descendants(encrypted, 'CipherReference')[0]?.getAttribute('URI');
      const path = uri ? resolveReference('', uri)?.path : undefined;
      const resource = [...resources.values()].find(item => item.path === path);
      const fontOnly = resource && /font|opentype/iu.test(resource.mediaType) && ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'].includes(algorithm ?? '');
      if (!fontOnly) throw new Error('Encrypted EPUB content is not supported. Import a DRM-free edition.');
    }
  }
  return { metadata, resources, spine, navigation, landmarks, warnings };
}

function optionalReference(base: string, href: string | null): Destination | undefined {
  try { return href == null ? undefined : resolveReference(base, href) ?? undefined; } catch { return undefined; }
}
function parseNavList(list: Element | undefined, path: string, level = 0): Navigation[] {
  if (!list || level > 64) return [];
  return children(list).filter(item => item.localName === 'li').map(item => {
    const label = children(item).find(child => child.localName === 'a' || child.localName === 'span');
    const nested = parseNavList(children(item).find(child => child.localName === 'ol'), path, level + 1);
    return { title: textOf(label), destination: optionalReference(path, label?.getAttribute('href') ?? null), level, children: nested };
  });
}
function parseNCX(parent: Element | undefined, path: string, level = 0): Navigation[] {
  if (!parent || level > 64) return [];
  return children(parent).filter(item => item.localName === 'navPoint').map(item => ({
    title: textOf(children(item).find(child => child.localName === 'navLabel')),
    destination: optionalReference(path, children(item).find(child => child.localName === 'content')?.getAttribute('src') ?? null),
    level, children: parseNCX(item, path, level + 1),
  }));
}

const KINDS: Record<string, SemanticSectionKind> = {
  cover: 'cover', titlepage: 'titlePage', 'copyright-page': 'copyright', copyright: 'copyright', dedication: 'dedication', toc: 'contents',
  foreword: 'foreword', preface: 'preface', acknowledgments: 'acknowledgments', introduction: 'introduction', prologue: 'introduction',
  part: 'part', volume: 'part', chapter: 'chapter', conclusion: 'conclusion', epilogue: 'epilogue', afterword: 'epilogue',
  appendix: 'appendix', glossary: 'glossary', endnotes: 'notes', footnotes: 'notes', notes: 'notes', bibliography: 'bibliography',
  index: 'index', colophon: 'colophon', credits: 'colophon', 'about-author': 'aboutAuthor', bodymatter: 'body', text: 'body',
  frontmatter: 'unknownFront', backmatter: 'unknownBack',
};
export function semanticKind(types: string[]): SemanticSectionKind | undefined {
  return types.map(type => KINDS[type]).find(kind => kind && !['body', 'unknownFront', 'unknownBack'].includes(kind))
    ?? types.map(type => KINDS[type]).find(Boolean);
}
