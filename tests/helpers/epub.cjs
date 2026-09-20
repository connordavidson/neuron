const { zipSync, strToU8 } = require('fflate');
const escape = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const xhtml = body => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Fixture</title></head><body>${body}</body></html>`;
const defaultDocuments = [
  {id:'one',path:'text/one.xhtml',body:'<section epub:type="chapter" id="one"><h1>Chapter One</h1><p>A gardener crossed the orchard. Her basket held ripe apples.</p><p>The sun rose slowly.</p></section>'},
  {id:'two',path:'text/two.xhtml',body:'<section epub:type="chapter" id="two"><h1>Chapter Two</h1><p>A carpenter repaired the bridge. His apprentice brought fresh planks.</p></section>'},
];
function epub(options = {}) {
  const documents = options.documents ?? defaultDocuments;
  const packagePath = options.packagePath ?? 'OPS/package.opf';
  const folder = packagePath.slice(0, packagePath.lastIndexOf('/') + 1);
  const version = options.version ?? 3;
  const href = path => path.split('/').map(encodeURIComponent).join('/');
  const items = documents.map(doc=>`<item id="${doc.id}" href="${href(doc.path)}" media-type="${doc.mediaType ?? 'application/xhtml+xml'}"${doc.fallback ? ` fallback="${doc.fallback}"` : ''}/>`).join('');
  const spine = options.spine ?? documents.filter(doc=>!doc.outsideSpine).map(doc=>`<itemref idref="${doc.id}"${doc.linear === false ? ' linear="no"' : ''}${doc.properties ? ` properties="${doc.properties}"` : ''}/>`).join('');
  const ncx = options.ncx ?? (version === 2 ? `<navMap>${documents.map((doc,i)=>`<navPoint id="n${i}"><navLabel><text>${doc.title ?? doc.id}</text></navLabel><content src="${href(doc.path)}"/></navPoint>`).join('')}</navMap>` : null);
  const nav = options.noNav ? null : options.navigation ?? `<nav epub:type="toc"><ol>${documents.filter(doc=>!doc.outsideSpine).map(doc=>`<li><a href="${href(doc.path)}">${doc.title ?? doc.id}</a></li>`).join('')}</ol></nav>`;
  const entries = {
    mimetype: [strToU8('application/epub+zip'), {level:0}],
    'META-INF/container.xml': strToU8(`<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="${href(packagePath)}" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    [packagePath]: strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A Garden &amp; a Bridge</dc:title><dc:creator>Example Author</dc:creator><dc:language>en</dc:language><dc:identifier id="book-id">urn:uuid:fixture</dc:identifier>${options.metadata ?? ''}</metadata><manifest>${items}${nav && version === 3 ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}${ncx ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ''}${options.manifest ?? ''}</manifest><spine${ncx ? ' toc="ncx"' : ''}>${spine}</spine>${options.guide ?? ''}</package>`),
  };
  for (const doc of documents) entries[folder+doc.path] = typeof doc.bytes === 'object' ? doc.bytes : strToU8(doc.raw ?? xhtml(doc.body));
  if (nav && version === 3) entries[folder+'nav.xhtml'] = strToU8(xhtml(nav));
  if (ncx) entries[folder+'toc.ncx'] = strToU8(`<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">${ncx}</ncx>`);
  for (const [path, content] of Object.entries(options.files ?? {})) {
    if (content === null) delete entries[path];
    else entries[path] = typeof content === 'string' ? strToU8(content) : content;
  }
  return zipSync(entries, {level:6});
}
module.exports = { epub, xhtml, defaultDocuments };
