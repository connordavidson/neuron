const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadSource } = require('./loadSource.cjs');
const {
  ReadingSession, buildReadingOffsets, chapterProgressMarkers, readingProgressAtPosition, summaryAtPosition,
} = loadSource('src/lib/readingPosition.ts');

const words = (count) => Array(count).fill('word').join(' ');
const content = {
  pdfUri: 'file:///unequal-chapters.pdf',
  // All three chapters have two reading pages, but contain 10, 40 and 50 words.
  paragraphs: [words(80), words(2), words(8), words(30), words(10), words(5), words(45), words(200)],
  readingStart: 1,
  chapters: [
    { title: 'Copyright', paragraphIndex: 0, kind: 'frontMatter' },
    { title: 'Part I', paragraphIndex: 1, kind: 'part' },
    { title: 'Chapter 1', paragraphIndex: 1, kind: 'chapter' },
    { title: 'A subheading', paragraphIndex: 2, kind: 'section' },
    { title: 'Chapter 2', paragraphIndex: 3, kind: 'chapter' },
    { title: 'Chapter 3', paragraphIndex: 5, kind: 'chapter' },
    { title: 'Notes', paragraphIndex: 7, kind: 'backMatter' },
  ],
  sections: [{ id: 'notes', kind: 'notes' }],
  readingUnits: Array.from({ length: 8 }, (_, index) => ({ sectionId: index === 7 ? 'notes' : 'body' })),
};

test('chapter distances reflect word counts, not chapter ordinals or reading-page counts', () => {
  const offsets = buildReadingOffsets(content);
  assert.equal(offsets.at(-1), 100, 'copyright and notes must not affect the scale');
  assert.deepEqual(chapterProgressMarkers(content, offsets), [0, 0.1, 0.5, 1]);
  assert.equal(readingProgressAtPosition(content, offsets, 3), 0.1);
  assert.equal(readingProgressAtPosition(content, offsets, 4), 0.4);
  assert.equal(readingProgressAtPosition(content, offsets, 5), 0.5);
});

test('rail and saved progress agree after restoring, swiping, jumping and resizing', () => {
  const offsets = buildReadingOffsets(content);
  const book = { currentParagraph: 4 };
  const session = new ReadingSession(book.currentParagraph, content.paragraphs.length);
  const matches = (expected) => {
    const fraction = readingProgressAtPosition(content, offsets, session.index);
    assert.equal(fraction, expected);
    assert.equal(fraction, summaryAtPosition(book, content, offsets, session.index).readingProgress);
  };
  session.scroll(0, 780);
  matches(0.4);
  session.beginDrag();
  session.scroll(5 * 780, 780);
  matches(0.5);
  session.scroll(4 * 780, 780);
  matches(0.4);
  session.jump(3);
  matches(0.1);
  session.layoutChanged();
  session.scroll(0, 320);
  matches(0.1);
  session.jump(0);
  matches(0);
  session.jump(7);
  matches(1);
});

test('missing chapters show a continuous rail and metadata refresh supplies proportional markers', () => {
  const offsets = buildReadingOffsets(content);
  assert.deepEqual(chapterProgressMarkers({ ...content, chapters: [] }, offsets), []);
  assert.deepEqual(chapterProgressMarkers({ ...content, chapters: content.chapters.filter(({ kind }) => kind !== 'chapter') }, offsets), []);
  assert.deepEqual(chapterProgressMarkers(content, offsets), [0, 0.1, 0.5, 1]);
});

test('legacy chapter metadata is supported; invalid and duplicate boundaries cannot distort the rail', () => {
  const legacy = { ...content, chapters: [
    { title: 'Third', paragraphIndex: 5 },
    { title: 'Second', paragraphIndex: 3 },
    { title: 'Duplicate', paragraphIndex: 3 },
    { title: 'First', paragraphIndex: 1 },
    ...[-1, 0, 2.5, 8, Infinity, NaN].map((paragraphIndex) => ({ title: 'Invalid', paragraphIndex })),
  ] };
  assert.deepEqual(chapterProgressMarkers(legacy, buildReadingOffsets(legacy)), [0, 0.1, 0.5, 1]);
});

test('closely spaced chapter positions retain their true proportions', () => {
  const dense = {
    ...content, readingStart: 0, sections: [], readingUnits: [],
    paragraphs: [words(1), words(1), words(998)],
    chapters: [0, 1, 2].map((paragraphIndex) => ({ title: `Chapter ${paragraphIndex + 1}`, paragraphIndex })),
  };
  assert.deepEqual(chapterProgressMarkers(dense, buildReadingOffsets(dense)), [0, 0.001, 0.002, 1]);
});

test('empty and single-page books have finite progress and bounded chapter markers', () => {
  for (const paragraphs of [[], [''], ['One short page']]) {
    const short = { ...content, readingStart: 0, paragraphs, sections: [], readingUnits: [], chapters: [{ title: 'Chapter 1', paragraphIndex: 0 }] };
    const offsets = buildReadingOffsets(short);
    assert.equal(readingProgressAtPosition(short, offsets, 50), 0);
    assert.deepEqual(chapterProgressMarkers(short, offsets), paragraphs[0] ? [0, 1] : []);
  }
});
