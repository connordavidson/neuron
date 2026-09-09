const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./loadSource.cjs');
const { splitSentences, repairQuotationBoundaries, paragraphizePagesWithMetadata } = loadSource('src/lib/paragraphize.ts');
const { detectSourceChapters, detectBookStructure, currentChapterAt } = loadSource('src/lib/bookStructure.ts');
const { sortLibrary } = loadSource('src/lib/libraryOrder.ts');

test('closing straight, curly, and nested quotes stay with their sentence', () => {
  for (const [open, close] of [['"', '"'], ['“', '”'], ['‘', '’'], ['«', '»'], ['(“', '”)']]) {
    for (const punctuation of ['.', '?', '!']) {
      const quoted = `She said ${open}Keep reading${punctuation}${close}`;
      assert.deepEqual(splitSentences(`${quoted} The next sentence follows.`), [quoted, 'The next sentence follows.']);
    }
  }
});

test('two-sentence cards include the second sentence’s closing quotation', () => {
  const cards = paragraphizePagesWithMetadata(['The journey begins. She said “We are ready.” They left together. The road was quiet.']);
  assert.deepEqual(cards.map(c => c.text), ['The journey begins. She said “We are ready.”', 'They left together. The road was quiet.']);
});

test('legacy quote repair preserves card count, indices, and opening quotes', () => {
  const original = ['The journey begins. She said “We are ready.', '” They left together. The road was quiet.', '“A new opening quote.” Another sentence.'];
  const repaired = repairQuotationBoundaries(original);
  assert.equal(repaired.length, original.length);
  assert.equal(repaired[0], original[0] + '”');
  assert.equal(repaired[1], 'They left together. The road was quiet.');
  assert.equal(repaired[2], original[2]);
  assert.equal(original[1][0], '”');
  assert.deepEqual(repairQuotationBoundaries(repaired), repaired);
  assert.deepEqual(repairQuotationBoundaries(['He said "Done.', '" Next. Last.']), ['He said "Done."', 'Next. Last.']);
});

test('complete bookmarks take precedence over unrelated body and notes headings', () => {
  const pages = ['Contents', 'One\nThe Beginning\nA story begins.', 'PART I: AN INNER SECTION', 'Two\nThe Ending\nThe story ends.', 'Notes\nChapter 12: A cited chapter'];
  const outlines = [{ title: 'One: The Beginning', pageIndex: 1 }, { title: 'Two: The Ending', pageIndex: 3 }, { title: 'Notes', pageIndex: 4 }];
  assert.deepEqual(detectSourceChapters(pages, outlines).map(c => c.pageIndex), [1, 3, 4]);
});

test('partial bookmarks gain missing chapters and fuller titles, not prose references', () => {
  const pages = ['Habit 1: Start Here', 'Habit 2:\nKeep Going\nPrinciples of Progress', 'Habit 3: A Passing Reference.', 'Habit 3:\nFinish Well'];
  const outlines = [{ title: 'Habit 1: Start Here', pageIndex: 0 }, { title: 'Habit 2:', pageIndex: 1 }];
  const chapters = detectSourceChapters(pages, outlines);
  assert.deepEqual(chapters.map(c => c.pageIndex), [0, 1, 3]);
  assert.match(chapters[1].title, /Keep Going/);
});

test('font changes stop titles before chart labels or smaller body subheadings', () => {
  const chapters = detectSourceChapters(['BOOK TITLE\nC H A P T E R 1\nTHE MAIN TITLE\nChart Legend\nFirst body sentence.'], [], [[12, 18, 24, 10, 10]]);
  assert.equal(chapters[0].title, 'CHAPTER 1: THE MAIN TITLE');
  assert.equal(chapters[0].endLineIndex, 3);
});

test('contents offsets are calibrated separately in combined volumes', () => {
  const pages = ['Contents\nFirst Start .... 1\nFirst Finish .... 3', 'First Start\nThe story begins.', 'Some body text.', 'First Finish\nThe story ends.',
    'Contents\nSecond Start .... 1\nSecond Finish .... 3', 'Second Start\nAnother story begins.', 'Other body text.', 'Second Finish\nAnother story ends.'];
  assert.deepEqual(detectSourceChapters(pages).map(c => c.pageIndex), [1, 3, 5, 7]);
});

test('chapter navigation maps to existing cards without changing their content', () => {
  const paragraphs = ['First chapter first sentence. Second sentence.', 'Last first-chapter sentence.', 'New chapter first sentence. Next sentence.'];
  const original = [...paragraphs];
  const source = [{ title: 'Chapter 1: Start', pageIndex: 2, lineIndex: 0, endLineIndex: 1 }, { title: 'Chapter 2: End', pageIndex: 7, lineIndex: 0, endLineIndex: 1 }];
  const result = detectBookStructure(paragraphs, { sourceChapters: source, paragraphPages: [2, 2, 7] });
  assert.deepEqual(result.chapters.map(c => c.paragraphIndex), [0, 2]);
  assert.equal(currentChapterAt(result.chapters, 1).title, 'Chapter 1: Start');
  assert.equal(currentChapterAt(result.chapters, 2).title, 'Chapter 2: End');
  assert.deepEqual(paragraphs, original);
});

test('new imports do not pair sentences across chapter boundaries', () => {
  const pages = ['Chapter 1\nFirst sentence. Second sentence. Third sentence.', 'Chapter 2\nFourth sentence. Fifth sentence.'];
  const records = paragraphizePagesWithMetadata(pages, detectSourceChapters(pages));
  assert.deepEqual(records.map(c => c.text), ['First sentence. Second sentence.', 'Third sentence.', 'Fourth sentence. Fifth sentence.']);
});

test('library sorts by most recently read and does not mutate stored input', () => {
  const books = [{ id: 'unread', importedAt: '2026-09-09' }, { id: 'older', importedAt: '2026-01-01', lastReadAt: '2026-09-07' }, { id: 'recent', importedAt: '2026-01-01', lastReadAt: '2026-09-08' }];
  assert.deepEqual(sortLibrary(books).map(b => b.id), ['recent', 'older', 'unread']);
  assert.equal(books[0].id, 'unread');
});
