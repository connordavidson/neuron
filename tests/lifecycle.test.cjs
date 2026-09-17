const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appHarness, sample, deferred, settle } = require('./helpers/app.cjs');

test('lifecycle: saved content opens without extraction or card replacement', async () => {
  const h = await appHarness();
  await h.open();
  assert.equal(h.calls.extract.length, 0);
  assert.deepEqual(h.reader().content.paragraphs, sample().content.paragraphs);
  assert.equal(h.reader().onImproveParsing, undefined);
  h.reader().onProgressChange(2);
  h.reader().onClose(2);
  await h.open();
  assert.equal(h.reader().book.currentParagraph, 2);
});

test('lifecycle: imported fields survive reopen and cache agrees with storage', async () => {
  const h = await appHarness();
  await h.screen().onImport();
  const book = h.library().find(b => b.id !== 'a' && b.id !== 'b');
  assert.ok(book);
  await h.open(book.id);
  for (const key of ['paragraphs', 'readingUnits', 'metadata', 'sections', 'blocks', 'supplements', 'layoutRevision']) {
    assert.deepEqual(h.reader().content[key], h.data.get(book.id)[key]);
  }
});

test('lifecycle: relocated owned PDF is used for chapter refresh', async () => {
  const h = await appHarness({ samples: [sample('a', { chapterVersion: 1 })], files: ['file:///new/FlowReader/Books/a.pdf'] });
  await h.open();
  await h.timers();
  assert.equal(h.calls.extract[0], 'file:///new/FlowReader/Books/a.pdf');
});

for (const action of ['move', 'close', 'switch', 'reopen', 'delete']) {
  test(`lifecycle: chapter refresh completion respects ${action}`, async () => {
    const gate = deferred();
    const h = await appHarness({ samples: [sample('a', { chapterVersion: 1 }), sample('b')], extract: () => gate.promise });
    await h.open();
    await h.timers();
    if (action === 'move') h.reader().onProgressChange(2);
    if (action === 'close' || action === 'reopen') h.reader().onClose(0);
    if (action === 'switch') await h.open('b');
    if (action === 'reopen') { await h.open(); h.reader().onProgressChange(2); }
    if (action === 'delete') await h.remove();
    gate.resolve({ pages: [] });
    await settle();
    if (action === 'move' || action === 'reopen') assert.equal(h.reader().book.currentParagraph, 2);
    if (action === 'close') assert.equal(h.reader(), undefined);
    if (action === 'switch') assert.equal(h.reader().book.id, 'b');
    if (action === 'delete') {
      assert.equal(h.data.has('a'), false);
      assert.ok(!h.library().some(b => b.id === 'a'));
      assert.equal(h.calls.chapter.length, 0);
    }
    assert.equal(h.calls.content.length, 0, 'refresh must not replace reading cards');
  });
}

for (const action of ['move', 'close', 'switch', 'delete']) {
  test(`lifecycle: chapter save completion respects ${action}`, async () => {
    const gate = deferred();
    const h = await appHarness({ samples: [sample('a', { chapterVersion: 1 }), sample('b')], chapterSave: () => gate.promise });
    await h.open();
    await h.timers();
    assert.equal(h.calls.chapter.length, 1);
    if (action === 'move') h.reader().onProgressChange(2);
    if (action === 'close') h.reader().onClose(0);
    if (action === 'switch') await h.open('b');
    if (action === 'delete') await h.remove();
    gate.resolve();
    await settle();
    if (action === 'move') assert.equal(h.reader().book.currentParagraph, 2);
    if (action === 'close') assert.equal(h.reader(), undefined);
    if (action === 'switch') assert.equal(h.reader().book.id, 'b');
    if (action === 'delete') assert.equal(h.data.has('a'), false);
    assert.equal(h.calls.content.length, 0);
  });
}

test('lifecycle: duplicate chapter refresh requests launch one extraction', async () => {
  const gate = deferred();
  const h = await appHarness({ samples: [sample('a', { chapterVersion: 1 })], extract: () => gate.promise });
  await h.open();
  await h.open();
  await h.timers();
  assert.equal(h.calls.extract.length, 1);
  gate.resolve({ pages: [] });
  await settle();
});

test('lifecycle: duplicate imports launch one extraction', async () => {
  const gate = deferred();
  const h = await appHarness({ extract: () => gate.promise });
  const callback = h.screen().onImport;
  const a = callback(), b = callback();
  await settle();
  assert.equal(h.calls.extract.length, 1);
  gate.resolve({});
  await Promise.all([a, b]);
});

test('lifecycle: latest open wins when loads resolve out of order', async () => {
  const gates = { a: deferred(), b: deferred() };
  const h = await appHarness({ load: id => gates[id].promise });
  const a = h.open('a'), b = h.open('b');
  gates.b.resolve(sample('b').content);
  await b;
  gates.a.resolve(sample().content);
  await a;
  assert.equal(h.reader().book.id, 'b');
});

test('lifecycle: failed chapter save preserves active layout and bookmark', async () => {
  const h = await appHarness({ samples: [sample('a', { chapterVersion: 1 })], chapterSave: async () => { throw Error('Disk full'); } });
  await h.open();
  h.reader().onProgressChange(2);
  await h.timers();
  assert.equal(h.calls.chapter.length, 1);
  assert.equal(h.reader().content.layoutRevision, 'original');
  assert.equal(h.reader().book.currentParagraph, 2);
  assert.equal(h.data.get('a').layoutRevision, 'original');
});

test('lifecycle: callbacks from a closed reader cannot change a reopened session', async () => {
  const h = await appHarness();
  await h.open();
  const old = h.reader();
  old.onClose(0);
  await h.open();
  old.onProgressChange(2);
  assert.equal(h.reader().book.currentParagraph, 0);
  old.onClose(2);
  assert.ok(h.reader());
});
