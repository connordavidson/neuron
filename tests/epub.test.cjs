const {test} = require('node:test');
const assert = require('node:assert/strict');
const {zipSync,strToU8} = require('fflate');
const {loadSource} = require('./loadSource.cjs');
const {epub,defaultDocuments,xhtml} = require('./helpers/epub.cjs');
const {parseEpub} = loadSource('src/lib/epub/parser.ts');
const {EpubArchive,bytesSource,EPUB_LIMITS,resolveReference} = loadSource('src/lib/epub/archive.ts');
const {buildReadingOffsets,summaryAtPosition,readingProgressAtPosition} = loadSource('src/lib/readingPosition.ts');
const {remapReadingPosition} = loadSource('src/lib/readingUnits.ts');
const {matchScannedPage} = loadSource('src/lib/pageScanMatcher.ts');
const parse = (options={}) => parseEpub(epub(options),'misleading.pdf');
const content = parsed => ({...parsed,source:{format:'epub',uri:'file:///book.epub'}});

for (const version of [2,3]) test(`EPUB ${version}: metadata, ordered chapters, cards, and locations`,async()=>{
  const parsed=await parse({version});
  assert.equal(parsed.metadata.title.value,'A Garden & a Bridge');
  assert.equal(parsed.metadata.authors[0].value,'Example Author');
  assert.equal(parsed.paragraphs[0],'A gardener crossed the orchard. Her basket held ripe apples.');
  assert.equal(parsed.paragraphs[1],'The sun rose slowly.');
  assert.equal(parsed.paragraphs[2],'A carpenter repaired the bridge. His apprentice brought fresh planks.');
  assert.deepEqual(parsed.chapters.map(chapter=>chapter.paragraphIndex),[0,2]);
  assert.equal(parsed.readingStart,0);
  assert.ok(parsed.chapters.every(chapter=>chapter.pageIndex === undefined));
  assert.equal(parsed.paragraphPages,undefined);
  for(const unit of parsed.readingUnits) {
    assert.ok(unit.sentenceCount<=2);
    assert.equal(unit.anchor.format,'epub'); assert.equal(unit.anchor.pageIndex,undefined);
    assert.deepEqual(unit.sourcePages,[]);
    assert.ok(unit.sentences.every(sentence=>sentence.anchor.documentPath && sentence.endAnchor.documentPath));
  }
  const book=content(parsed), offsets=buildReadingOffsets(book);
  assert.equal(summaryAtPosition({currentParagraph:2},book,offsets).currentSourcePage,undefined);
  assert.equal(readingProgressAtPosition(book,offsets,2),1);
});

test('EPUB: nested navigation resolves fragment targets and parent-only labels',async()=>{
  const parsed=await parse({documents:[{id:'both',path:'text/both.xhtml',body:'<h1 id="a">First</h1><p>The first chapter begins. Another sentence follows.</p><h1 id="b">Second</h1><p>The second chapter begins. Another thought follows.</p>'}],
    navigation:'<nav epub:type="toc"><ol><li><span>Part One</span><ol><li><a href="text/both.xhtml#a">First</a></li><li><a href="text/both.xhtml#b">Second</a></li></ol></li></ol></nav>'});
  assert.deepEqual(parsed.chapters.map(c=>[c.title,c.paragraphIndex,c.level]),[['Part One',0,0],['First',0,1],['Second',1,1]]);
  assert.equal(parsed.sections[1].parentId,parsed.sections[0].id);
  assert.equal(parsed.sections[0].endUnit,1);
});

test('EPUB: one chapter can continue into another spine document',async()=>{
  const parsed=await parse({documents:[{id:'a',path:'a.xhtml',body:'<h1>Chapter One</h1><p>The story continues</p>'},{id:'b',path:'b.xhtml',body:'<p>across a document boundary. A second sentence follows.</p>'}],
    navigation:'<nav epub:type="toc"><ol><li><a href="a.xhtml">Chapter One</a></li></ol></nav>'});
  assert.deepEqual(parsed.paragraphs,['The story continues across a document boundary. A second sentence follows.']);
  assert.equal(parsed.chapters.length,1);
  assert.equal(parsed.readingUnits[0].anchor.documentPath,'OPS/a.xhtml');
  assert.equal(parsed.readingUnits[0].endAnchor.documentPath,'OPS/b.xhtml');
});

test('EPUB: text nodes preserve inline words, entities, Unicode, lists, and quotations once',async()=>{
  const parsed=await parse({noNav:true,documents:[{id:'a',path:'a.xhtml',body:'<h1>Chapter One</h1><blockquote><p>“Hel<em>lo</em>&nbsp;world.” Another sentence.</p></blockquote><ul><li>First item.</li><li>Second item.</li></ul><p hidden="hidden">SECRET.</p><p style="display: none !important">HIDDEN.</p><script>Bad script.</script><p>Emojis 🦋 and café remain.</p>'}]});
  assert.equal(parsed.paragraphs.join(' '),'“Hello world.” Another sentence. First item. Second item. Emojis 🦋 and café remain.');
  assert.equal(parsed.chapters[0].title,'Chapter One');
});

test('EPUB: encoded relative paths and arbitrary package locations',async()=>{
  const parsed=await parse({packagePath:'Books/My Package.data',documents:[{id:'one',path:'texts/chapter one.xhtml',body:'<h1 id="café">First</h1><p>A sentence begins. Another sentence ends.</p>'}],
    navigation:'<nav epub:type="toc"><ol><li><a href="texts/../texts/chapter%20one.xhtml#caf%C3%A9">First</a></li></ol></nav>'});
  assert.equal(parsed.chapters[0].title,'First');
  assert.equal(parsed.readingUnits[0].anchor.documentPath,'Books/texts/chapter one.xhtml');
  assert.deepEqual(resolveReference('Books/texts/a.xhtml','../notes.xhtml#n'),{path:'Books/notes.xhtml',fragment:'n'});
});

test('EPUB: front matter stays readable, starts at introduction, excludes optional material',async()=>{
  const parsed=await parse({documents:[
    {id:'copy',path:'copy.xhtml',body:'<section epub:type="copyright-page"><h1>Copyright</h1><p>Copyright information. All rights reserved.</p></section>'},
    {id:'intro',path:'intro.xhtml',body:'<section epub:type="introduction"><h1>Introduction</h1><p>The journey begins. We look ahead.</p></section>'},
    {id:'one',path:'one.xhtml',body:defaultDocuments[0].body},
    {id:'notes',path:'notes.xhtml',body:'<section epub:type="endnotes"><h1>Notes</h1><p>A source reference. Another source reference.</p></section>'},
  ]});
  assert.ok(parsed.readingStart>0);
  assert.match(parsed.paragraphs[parsed.readingStart],/The journey/);
  const offsets=buildReadingOffsets(content(parsed));
  assert.equal(offsets[parsed.readingStart],0);
  const notes=parsed.sections.find(s=>s.kind==='notes');
  assert.equal(offsets[notes.startUnit],offsets.at(-1));
});

test('EPUB: non-linear material moves after the body and never adds progress',async()=>{
  const parsed=await parse({documents:[{id:'extra',path:'extra.xhtml',linear:false,body:'<h1>Extra</h1><p>Optional words remain readable. This is an aside.</p>'},...defaultDocuments]});
  assert.match(parsed.paragraphs.at(-1),/Optional words/);
  assert.match(parsed.paragraphs[parsed.readingStart],/gardener/);
  const offsets=buildReadingOffsets(content(parsed));
  assert.equal(offsets.at(-2),offsets.at(-1));
});

test('EPUB: exact footnote references attach to the right card, including external note documents',async()=>{
  const parsed=await parse({documents:[{id:'a',path:'a.xhtml',body:'<h1>Chapter One</h1><p>The first sentence. The second sentence.</p><p>The third sentence<a epub:type="noteref" href="notes.xhtml#n1">1</a>. The fourth sentence.</p><p>The fifth sentence<a epub:type="noteref" href="notes.xhtml#n1">1</a>. The sixth sentence.</p>'},
    {id:'notes',path:'notes.xhtml',outsideSpine:true,body:'<section epub:type="endnotes"><h1>Notes</h1><aside epub:type="footnote" id="n1"><p>An explanatory note.</p><a epub:type="backlink" href="a.xhtml">Back</a></aside></section>'}]});
  const note=parsed.supplements.find(s=>s.kind==='footnote');
  assert.equal(note.text,'An explanatory note.');
  assert.deepEqual(parsed.readingUnits.slice(0,3).map(u=>u.supplementIds.includes(note.id)),[false,true,true]);
  assert.ok(parsed.paragraphs.some(p=>p.includes('An explanatory note.')));
  assert.ok(!parsed.paragraphs.join(' ').includes('sentence1'));
});

test('EPUB 2: superscript note links use the same context panel',async()=>{
  const parsed=await parse({version:2,documents:[{id:'a',path:'a.xhtml',body:'<h1>Chapter One</h1><p>A useful statement<sup><a href="notes.xhtml#note">1</a></sup>. More words follow.</p>'},
    {id:'notes',path:'notes.xhtml',linear:false,body:'<h1>Notes</h1><p id="note">A useful source citation.</p>'}]});
  assert.match(parsed.paragraphs[0],/statement\. More/);
  assert.ok(parsed.readingUnits[0].supplementIds.length);
  assert.ok(parsed.supplements.some(note=>note.text==='A useful source citation.'));
});

test('EPUB: an introduction in a later part must not skip the opening chapter',async()=>{
  const parsed=await parse({documents:[defaultDocuments[0],{id:'later',path:'later.xhtml',body:'<section epub:type="introduction"><h1>A later introduction</h1><p>Another part begins. More ideas follow.</p></section>'}]});
  assert.equal(parsed.readingStart,0);
});

test('EPUB: publisher boilerplate and sparse title headings remain optional',async()=>{
  const parsed=await parse({noNav:true,documents:[
    {id:'front',path:'front.xhtml',body:'<header class="pg-boilerplate"><h2>Publisher information</h2><p>License information. All rights reserved.</p></header><h1>A Garden &amp; a Bridge</h1><p>Example Author</p>'},
    defaultDocuments[0],
    {id:'back',path:'back.xhtml',body:'<footer class="pg-boilerplate"><h2>Publisher license</h2><p>Terms remain accessible. Additional licensing text.</p></footer>'},
  ]});
  assert.match(parsed.paragraphs[parsed.readingStart],/gardener/);
  assert.ok(parsed.paragraphs.join(' ').includes('Example Author'));
  const offsets=buildReadingOffsets(content(parsed));
  assert.equal(offsets[parsed.readingStart],0);
  const footer=parsed.sections.find(section=>section.kind==='colophon');
  assert.equal(offsets[footer.startUnit],offsets.at(-1));
});

test('EPUB: fallback-only books retain unheaded opening prose and all sentence pairing rules',async()=>{
  const long=Array.from({length:34},(_,i)=>`word${i}`).join(' ')+'.';
  const parsed=await parse({noNav:true,documents:[{id:'plain',path:'plain.xhtml',body:`<p>Unheaded opening. It stays available.</p><h1>Chapter One</h1><p>${long} A second sentence. A third sentence.</p>`}]});
  assert.equal(parsed.paragraphs[0],'Unheaded opening. It stays available.');
  assert.equal(parsed.paragraphs[1],long);
  assert.equal(parsed.paragraphs[2],'A second sentence.');
  assert.equal(parsed.paragraphs[3],'A third sentence.');
});

test('EPUB: print page markers do not become text or PDF page numbers',async()=>{
  const parsed=await parse({documents:[{id:'a',path:'a.xhtml',body:'<h1>Chapter One</h1><p>The sentence<span epub:type="pagebreak" id="page12" title="12"/> continues. Another follows.</p>'}]});
  assert.equal(parsed.paragraphs[0],'The sentence continues. Another follows.');
  assert.equal(parsed.readingUnits[0].anchor.pageIndex,undefined);
});

test('EPUB: captions, image alternatives and table text stay contextual',async()=>{
  const parsed=await parse({documents:[{id:'a',path:'a.xhtml',body:'<h1>Chapter One</h1><p>A gardener studies the orchard. It looks healthy.</p><figure><img src="image.png" alt="An apple tree"/><figcaption>The orchard in spring.</figcaption></figure><table><tr><th>Tree</th><th>Count</th></tr><tr><td>Apple</td><td>3</td></tr></table>'}]});
  assert.equal(parsed.paragraphs.length,1);
  assert.deepEqual(parsed.supplements.map(s=>s.kind),['caption','caption','table']);
  assert.match(parsed.supplements[2].text,/Tree.*Count.*Apple.*3/);
  assert.equal(parsed.readingUnits[0].supplementIds.length,3);
});

test('EPUB: broken optional navigation falls back to headings',async()=>{
  const parsed=await parse({files:{'OPS/nav.xhtml':'<html><unclosed>'}});
  assert.deepEqual(parsed.chapters.map(c=>c.title),['Chapter One','Chapter Two']);
  assert.ok(parsed.diagnostics.warnings.length);
});

const ebookLibMetadata='<meta name="generator" content="Ebook-lib 0.17.1"/>';
const bodySpine='<itemref idref="nav"/><itemref idref="one"/><itemref idref="two"/>';
test('EPUB: recovers an EbookLib dangling leading cover without losing reading content',async()=>{
  const options={metadata:ebookLibMetadata,navigation:'<nav epub:type="toc"><ol/></nav>'};
  const baseline=await parse({...options,spine:bodySpine});
  const parsed=await parse({...options,spine:'<itemref idref="cover"/>'+bodySpine});
  assert.deepEqual(parsed.paragraphs,baseline.paragraphs);
  assert.deepEqual(parsed.chapters.map(c=>c.title),baseline.chapters.map(c=>c.title));
  assert.equal(parsed.readingStart,baseline.readingStart);
  assert.ok(parsed.diagnostics.warnings.some(w=>/missing.*cover/iu.test(w)));
  assert.equal(parsed.readingUnits[0].anchor.spineIndex,2,'source spine indices retain their original positions');
});

for(const [name,options] of [
  ['undeclared body',{metadata:ebookLibMetadata,spine:'<itemref idref="missing-chapter"/>'+bodySpine}],
  ['unrecognized producer',{spine:'<itemref idref="cover"/>'+bodySpine}],
  ['non-leading undeclared cover',{metadata:ebookLibMetadata,spine:bodySpine+'<itemref idref="cover"/>'}],
  ['declared but missing cover',{metadata:ebookLibMetadata,spine:'<itemref idref="cover"/>'+bodySpine,manifest:'<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>'}],
  ['missing body file',{metadata:ebookLibMetadata,spine:'<itemref idref="cover"/>'+bodySpine,files:{'OPS/text/one.xhtml':null}}],
]) test(`EPUB: ${name} still fails with a local-content error`,async()=>{
  await assert.rejects(parse(options),error=>{
    assert.match(error.message,/missing required reading content/);
    assert.doesNotMatch(error.message,/remote/i);
    return true;
  });
});

test('EPUB: only actual remote spine resources produce a remote-content error',async()=>{
  await assert.rejects(parse({manifest:'<item id="remote" href="https://example.invalid/book.xhtml" media-type="application/xhtml+xml"/>',spine:'<itemref idref="remote"/>'+bodySpine}),/requires remote reading content/);
});

test('EPUB: duplicate prose resolves bookmarks within the correct source document',async()=>{
  const parsed=await parse({documents:['a','b'].map(id=>({id,path:`${id}.xhtml`,body:`<h1>${id}</h1><p>Repeated sentence. Another repeated sentence.</p>`}))});
  assert.equal(remapReadingPosition(parsed.readingUnits[1].anchor,parsed.readingUnits).index,1);
});

test('EPUB: the physical-page matcher finds a passage across generated reading cards',async()=>{
  const scan='The narrow river wound beneath the abandoned mill while swallows circled above the broken wheel. Silver leaves drifted downstream past a wooden bridge where the carpenter carefully measured each plank before beginning his repairs. Beside the orchard a gardener filled her basket with ripe apples and carried them toward the farmhouse.';
  const parsed=await parse({documents:[defaultDocuments[0],{id:'target',path:'target.xhtml',body:`<h1>The River</h1><p>${scan}</p>`},defaultDocuments[1]]});
  const match=matchScannedPage(parsed.paragraphs,scan);
  assert.equal(match.status,'matched');
  assert.equal(match.paragraphIndex,parsed.chapters.find(c=>c.title==='target').paragraphIndex);
});

for(const [name,options,pattern] of [
  ['fixed layout',{metadata:'<meta property="rendition:layout">pre-paginated</meta>'},/Fixed-layout/],
  ['mixed layout',{documents:[{...defaultDocuments[0],properties:'rendition:layout-pre-paginated'},defaultDocuments[1]]},/Fixed-layout/],
  ['missing body',{files:{'OPS/text/one.xhtml':null}},/missing required/],
  ['image only',{documents:[{id:'a',path:'a.xhtml',body:'<img src="a.png" alt="Cover image"/>'}]},/no readable text/],
  ['malformed body',{documents:[{id:'a',path:'a.xhtml',raw:'<html><broken>'}]},/unreadable|body/],
  ['entities',{documents:[{id:'a',path:'a.xhtml',raw:'<!DOCTYPE html [<!ENTITY custom "no">]><html><body>&custom;</body></html>'}]},/entities/],
  ['encrypted content',{files:{'META-INF/encryption.xml':'<encryption><EncryptedData><EncryptionMethod Algorithm="secret"/><CipherData><CipherReference URI="OPS/text/one.xhtml"/></CipherData></EncryptedData></encryption>'}},/Encrypted/],
]) test(`EPUB: rejects ${name}`,async()=>{await assert.rejects(parse(options),pattern);});

test('EPUB: font-only obfuscation is accepted without reading the font',async()=>{
  const parsed=await parse({manifest:'<item id="font" href="font.otf" media-type="application/vnd.ms-opentype"/>',files:{
    'META-INF/encryption.xml':'<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="OPS/font.otf"/></CipherData></EncryptedData></encryption>',
    'OPS/font.otf':'not a font',
  }});
  assert.equal(parsed.paragraphs.length,3);
});

test('EPUB: UTF-16 documents are decoded',async()=>{
  const raw=xhtml('<h1>Chapter One</h1><p>A butterfly 🦋 flies. The garden waits.</p>').replace('UTF-8','UTF-16');
  const bytes=new Uint8Array(Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(raw,'utf16le')]));
  assert.match((await parse({documents:[{id:'a',path:'a.xhtml',bytes}]})).paragraphs[0],/🦋/);
});

test('EPUB archive: rejects truncation, traversal, limits and corrupt content',async()=>{
  const data=epub();
  assert.throws(()=>new EpubArchive(bytesSource(data.slice(0,-10))),/damaged/);
  assert.throws(()=>new EpubArchive(bytesSource(zipSync({'../bad':strToU8('bad')}))),/damaged/);
  assert.throws(()=>new EpubArchive(bytesSource(data),{...EPUB_LIMITS,compressed:10}),/too large/);
  assert.throws(()=>new EpubArchive(bytesSource(data),{...EPUB_LIMITS,entries:1}),/too large/);
  const archive=new EpubArchive(bytesSource(data),{...EPUB_LIMITS,document:10});
  await assert.rejects(archive.readText('mimetype'),/too large/);
  const total=new EpubArchive(bytesSource(data),{...EPUB_LIMITS,text:25});
  await total.readText('mimetype'); await assert.rejects(total.readText('META-INF/container.xml'),/too large/);
  const broken=data.slice(); broken[38]^=1;
  await assert.rejects(new EpubArchive(bytesSource(broken)).readText('mimetype'),/damaged/);
});
