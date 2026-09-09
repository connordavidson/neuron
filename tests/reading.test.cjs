const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Exercise the actual TypeScript without adding a second transpiler to the app.
function loadSource(name, mocks = {}, cache = new Map()) {
  const filename = path.resolve(__dirname, '..', name);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const sourceRequire = (specifier) => {
    if (specifier in mocks) return mocks[specifier];
    if (specifier.startsWith('.')) {
      return loadSource(path.resolve(path.dirname(filename), `${specifier}.ts`), mocks, cache);
    }
    return require(specifier);
  };
  new Function('require', 'module', 'exports', code)(sourceRequire, module, module.exports);
  return module.exports;
}

const { ReadingSession, buildReadingOffsets, summaryAtPosition, displayedProgress } =
  loadSource('src/lib/readingPosition.ts');

const content = {
  pdfUri: 'file:///fixture.pdf',
  parserVersion: 1,
  paragraphs: ['Copyright credits', 'one two three four five six', 'seven eight', 'nine ten'],
  paragraphPages: [0, 4, 5, 5],
  chapters: [{ paragraphIndex: 1, title: 'First chapter' }],
  readingStart: 1,
};
const book = {
  id: 'fixture', title: 'Fixture', originalFileName: 'fixture.pdf',
  importedAt: '2026-09-09', currentParagraph: 2, paragraphCount: 400,
};

test('restore does not write transient initial offsets, even deep in a book', () => {
  const session = new ReadingSession(3210, 10000);
  for (const offset of [0, 780, 3210 * 780, 0]) session.scroll(offset, 780);
  assert.equal(session.index, 3210);
  session.beginDrag();
  session.scroll(3211 * 780, 780);
  assert.equal(session.index, 3211);
});

test('closing/reopening after forward and backward swipes restores the same page', () => {
  const session = new ReadingSession(25, 100);
  session.beginDrag();
  session.scroll(29.8 * 780, 780);
  session.scroll(30 * 780, 780);
  session.scroll(28 * 780, 780);
  const restored = new ReadingSession(session.index, 100);
  restored.scroll(0, 780);
  assert.equal(restored.index, 28);
});

test('chapter jumps and resizing cannot be overwritten by programmatic scroll callbacks', () => {
  const session = new ReadingSession(200, 1000);
  session.beginDrag();
  assert.equal(session.jump(10), 10);
  session.scroll(199 * 780, 780);
  assert.equal(session.index, 10);
  session.beginDrag();
  session.scroll(11 * 780, 780);
  session.layoutChanged();
  session.scroll(0, 400);
  assert.equal(session.index, 11);
  session.beginDrag();
  session.scroll(12 * 400, 400);
  assert.equal(session.index, 12);
});

test('fractional viewport heights stay aligned after thousands of pages', () => {
  const height = 779 + 2 / 3;
  const session = new ReadingSession(0, 20000);
  session.beginDrag();
  for (const index of [0, 1, 100, 3000, 15000, 19999]) {
    session.scroll(index * height, height);
    assert.equal(session.index, index);
  }
});

test('progress uses body text, corrects stale counts, and exposes physical PDF page', () => {
  const summary = summaryAtPosition(book, content, buildReadingOffsets(content));
  assert.equal(summary.paragraphCount, 4);
  assert.equal(summary.currentParagraph, 2);
  assert.equal(summary.readingProgress, 0.6);
  assert.equal(summary.currentSourcePage, 6);
  assert.equal(displayedProgress(summary).label, '60% read');
});

test('front-matter bookmarks are preserved, with zero body progress', () => {
  const summary = summaryAtPosition(book, content, buildReadingOffsets(content), 0);
  assert.equal(summary.currentParagraph, 0);
  assert.equal(summary.readingProgress, 0);
  assert.equal(new ReadingSession(summary.currentParagraph, 4).index, 0);
});

test('repeated opens do not advance progress or change the saved content', () => {
  let summary = book;
  const offsets = buildReadingOffsets(content);
  const snapshot = JSON.stringify(content);
  for (let i = 0; i < 20; i++) {
    summary = summaryAtPosition(summary, content, offsets);
    assert.equal(summary.currentParagraph, 2);
    assert.equal(summary.readingProgress, 0.6);
  }
  assert.equal(JSON.stringify(content), snapshot);
});

test('completion labels never round an unfinished book up to 100%', () => {
  assert.equal(displayedProgress({ ...book, readingProgress: 0.999 }).label, '99% read');
  const summary = summaryAtPosition(book, content, buildReadingOffsets(content), 3);
  assert.equal(summary.readingProgress, 1);
  assert.equal(displayedProgress(summary).label, 'Finished');
});

test('empty and single-page books never produce NaN progress', () => {
  for (const paragraphs of [[], ['Only one reading page.']]) {
    const short = { ...content, paragraphs, readingStart: 0 };
    const summary = summaryAtPosition(book, short, buildReadingOffsets(short));
    assert.equal(summary.readingProgress, 0);
    assert.equal(summary.currentParagraph, 0);
  }
});

test('queued disk saves keep the latest bookmark and percentage across a restart', async () => {
  const data = new Map();
  let writes = 0;
  const mockStorage = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      const delay = writes++ === 0 ? 20 : 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
      data.set(key, value);
    },
  };
  const storage = loadSource('src/lib/storage.ts', {
    '@react-native-async-storage/async-storage': mockStorage,
    'expo-file-system': {},
  });
  const offsets = buildReadingOffsets(content);
  await storage.storeBook({ ...book, ...content });
  writes = 0;
  const saves = [1, 3, 2].map((position) =>
    storage.persistLibrary([summaryAtPosition(book, content, offsets, position)]));
  await Promise.all(saves);
  const restartedStorage = loadSource('src/lib/storage.ts', {
    '@react-native-async-storage/async-storage': mockStorage,
    'expo-file-system': {},
  });
  const [restored] = await restartedStorage.loadLibrary();
  assert.equal(restored.currentParagraph, 2);
  assert.equal(restored.readingProgress, 0.6);
  const storedContent = await restartedStorage.loadBookContent(book.id);
  assert.deepEqual(storedContent, { ...content, chapterVersion: undefined });
});
