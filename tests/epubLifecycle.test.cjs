const {test}=require('node:test');
const assert=require('node:assert/strict');
const {appHarness,sample,deferred,settle}=require('./helpers/app.cjs');
const {epub}=require('./helpers/epub.cjs');
const {loadSource}=require('./loadSource.cjs');
const {parseEpub}=loadSource('src/lib/epub/parser.ts');
const {normalizeStoredContent,contentFromParsed}=loadSource('src/lib/bookContent.ts');
const {buildReadingOffsets,summaryAtPosition}=loadSource('src/lib/readingPosition.ts');
const {nodes,createRenderer,nativeMock}=require('./helpers/render.cjs');
async function until(predicate) {
  for(let count=0;count<100 && !predicate();count++) await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(predicate(),'asynchronous import should finish');
}

test('EPUB import: picker detects actual bytes despite incorrect name and MIME type',async()=>{
  const h=await appHarness({importBytes:epub(),pickResult:{assets:[{uri:'file:///renamed.pdf',name:'renamed.pdf',mimeType:'application/pdf'}]}});
  await h.screen().onImport();
  assert.deepEqual(h.calls.picker[0].type,['application/pdf','application/epub+zip']);
  assert.equal(h.calls.extract.length,0);
  assert.equal(h.calls.epub.length,1);
  const book=h.library().find(book=>book.format==='epub');
  assert.ok(book); assert.equal(book.originalFileName,'renamed.pdf');
  assert.ok(h.files.has(`file:///new/Neuron/Books/${book.id}.epub`));
  assert.ok([...h.files].every(path=>!path.endsWith('.import')));
  assert.equal(h.reader(),undefined,'picker import remains in the library');
  await h.open(book.id); await h.timers();
  assert.equal(h.calls.extract.length,0,'EPUB never triggers PDF chapter refresh');
  assert.equal(h.calls.chapter.length,0);
  h.reader().onProgressChange(2); h.reader().onClose(2);
  await h.open(book.id);
  assert.equal(h.reader().book.currentParagraph,2);
  assert.equal(h.reader().book.currentAnchor.format,'epub');
  assert.equal(h.reader().book.currentSourcePage,undefined);
  assert.equal(h.calls.epub.length,1,'cached reopen does not parse again');
  assert.ok(h.calls.handles.every(handle=>handle.closed));
  await h.remove(book.id);
  assert.equal(h.data.has(book.id),false);
  assert.equal(h.files.has(`file:///new/Neuron/Books/${book.id}.epub`),false);
});

test('PDF import: a misleading EPUB extension still uses the PDF adapter',async()=>{
  const h=await appHarness({pickResult:{assets:[{uri:'file:///renamed.epub',name:'renamed.epub',mimeType:'application/epub+zip'}]}});
  await h.screen().onImport();
  assert.equal(h.calls.extract.length,1); assert.equal(h.calls.epub.length,0);
  assert.match(h.calls.extract[0],/\.pdf$/);
});

for(const format of ['epub','pdf']) test(`${format.toUpperCase()} import waits for the owned file move before parsing`,async()=>{
  const gate=deferred();let moving=false;
  const h=await appHarness({
    importBytes:format==='epub'?epub():Buffer.from('%PDF-1.7\nfixture'),
    move:()=>{moving=true;return gate.promise;},
  });
  const importing=h.screen().onImport();
  try {
    await until(()=>moving);
    assert.equal(h.calls.epub.length+h.calls.extract.length,0,'neither parser may open the unfinished destination');
    assert.equal(h.screen().isImporting,true);
    assert.equal(h.library().length,2,'no book is published before the move finishes');
    assert.equal(h.alerts.length,0);
    assert.ok([...h.files].some(path=>path.endsWith('.import')));
  } finally {
    gate.resolve();
    await importing;
  }
  const book=h.library().find(book=>book.format===format);
  assert.ok(book);
  assert.ok(h.files.has(`file:///new/Neuron/Books/${book.id}.${format}`));
  assert.ok([...h.files].every(path=>!path.endsWith('.import')));
  assert.equal(h.calls.epub.length+h.calls.extract.length,1);
  assert.equal(h.alerts.length,0);
});

for(const [name,options] of [
  ['unsupported bytes',{importBytes:Buffer.from('not an ebook')}],
  ['damaged EPUB',{importBytes:epub().slice(0,-8)}],
  ['fixed layout',{importBytes:epub({metadata:'<meta property="rendition:layout">pre-paginated</meta>'})}],
  ['content storage failure',{importBytes:epub(),storeBook:async()=>{throw Error('Disk full');}}],
  ['library storage failure',{importBytes:epub(),persistLibrary:async()=>{throw Error('Disk full');}}],
  ['interrupted copy',{copy:async()=>{throw Error('Provider unavailable');}}],
  ['interrupted move',{importBytes:epub(),move:async()=>{throw Error('Storage unavailable');}}],
]) test(`Import rollback: ${name} leaves no book or owned file`,async()=>{
  const h=await appHarness(options);
  await h.screen().onImport();
  assert.equal(h.library().length,2);
  assert.equal(h.data.size,2);
  assert.equal(h.files.size,0);
  assert.equal(h.screen().isImporting,false);
  assert.equal(h.alerts.at(-1)[0],'Couldn’t import book');
  assert.ok(h.calls.handles.every(handle=>handle.closed));
});

test('EPUB storage: semantic content and bookmark survive roundtrip and a fresh session',async()=>{
  const parsed=await parseEpub(epub(),'garden.epub');
  const content=contentFromParsed(parsed,'file:///old/book.epub','epub-revision','epub');
  const serialized=JSON.stringify(content);
  const loaded=normalizeStoredContent(serialized,JSON.stringify({chapterVersion:999,chapters:[],layoutRevision:'epub-revision'}));
  assert.deepEqual(JSON.parse(JSON.stringify(loaded)),JSON.parse(serialized));
  const summary=summaryAtPosition({id:'book',format:'epub',title:'Garden',originalFileName:'garden.epub',currentParagraph:2},loaded,buildReadingOffsets(loaded));
  const h=await appHarness({samples:[{summary,content:loaded}],files:['file:///new/Neuron/Books/book.epub']});
  await h.open('book'); await h.timers();
  assert.equal(h.reader().book.currentParagraph,2);
  assert.equal(h.calls.extract.length+h.calls.epub.length,0);
  await h.remove('book');
  assert.equal(h.files.size,0,'deletion resolves the relocated EPUB');
});

test('EPUB import: concurrent requests run one parser',async()=>{
  const gate=deferred(), parsed=await parseEpub(epub(),'book.epub');
  const h=await appHarness({importBytes:epub(),parseEpub:()=>gate.promise});
  const first=h.screen().onImport(),second=h.screen().onImport();
  await until(()=>h.calls.epub.length===1);
  assert.equal(h.calls.epub.length,1);
  gate.resolve(parsed);await Promise.all([first,second]);
  assert.equal(h.library().filter(book=>book.format==='epub').length,1);
});

test('EPUB import: incoming file opens automatically, failed incoming URLs can be retried',async()=>{
  const parsed=await parseEpub(epub(),'book.epub');let fail=true;
  const h=await appHarness({importBytes:epub(),parseEpub:async()=>{if(fail)throw Error('Temporarily unavailable');return parsed;}});
  h.incoming('file:///book.epub');await until(()=>h.alerts.length>0);
  assert.equal(h.reader(),undefined);assert.equal(h.alerts.at(-1)[0],'Couldn’t import book');
  fail=false;h.incoming('file:///book.epub');await until(()=>h.reader()!=null);
  assert.equal(h.reader().book.format,'epub');
  assert.equal(h.reader().book.currentParagraph,parsed.readingStart);
  h.incoming('file:///book.epub');await settle();
  assert.equal(h.calls.epub.length,2,'successful URL is imported only once');
});

test('Import: cancelled picker does not copy or create a book',async()=>{
  const h=await appHarness({pickResult:{canceled:true}});await h.screen().onImport();
  assert.equal(h.calls.extract.length+h.calls.epub.length,0);assert.equal(h.files.size,0);
});

test('EPUB reader panels use reading pages, retain nested chapters and contextual notes',async()=>{
  const renderer=createRenderer(),native=nativeMock();
  const panels=loadSource('src/components/ReaderPanels.tsx',{react:renderer.react,'react-native':native});
  const theme={foreground:'#000',secondary:'#777',background:'#fff'};
  const common={activeTheme:theme,preferences:{theme:'paper',fontSize:24},onClose(){}};
  const chapters=nodes(panels.ChaptersPanel({...common,content:{source:{format:'epub'},chapters:[{title:'One',paragraphIndex:3,level:1}]},navigationStart:0,goToParagraph(){},updatingChapters:false}));
  const text=JSON.stringify(chapters);
  assert.match(text,/Reading page 4/);assert.ok(!text.includes('PDF page'));
  const notes=JSON.stringify(nodes(panels.ContextPanel({...common,currentSupplements:[{id:'note',kind:'footnote',text:'A note.',anchor:{format:'epub'},readingPage:4}]})));
  assert.match(notes,/Reading page 4/);assert.ok(!notes.includes('PDF page'));
});
