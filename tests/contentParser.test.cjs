const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./loadSource.cjs');
const {
  CONTENT_PARSER_VERSION,
  parseEbook,
  remapReadingPosition,
  sourceAnchorForLegacy,
} = loadSource('src/lib/contentParser.ts');

function page(index, lines, label = String(index + 1)) {
  let sourceStart = 0;
  const spans = lines.map((line, lineIndex) => {
    const text = typeof line === 'string' ? line : line.text;
    const fontSize = typeof line === 'string' ? 11 : line.fontSize ?? 11;
    const y = typeof line === 'string' ? 80 + lineIndex * 18 : line.y ?? 80 + lineIndex * 18;
    const x = typeof line === 'string' ? 68 : line.x ?? 68;
    const sourceEnd = sourceStart + text.length;
    const span = {
      text,
      sourceStart,
      sourceEnd,
      lineIndex,
      bounds: { x, y, width: Math.min(480, text.length * fontSize * 0.48), height: fontSize * 1.15 },
      fontName: 'TimesNewRomanPSMT',
      fontSize,
      bold: typeof line === 'string' ? false : line.bold ?? false,
      italic: false,
    };
    sourceStart = sourceEnd + 1;
    return span;
  });
  return {
    index,
    label,
    width: 612,
    height: 792,
    rotation: 0,
    text: lines.map(line => typeof line === 'string' ? line : line.text).join('\n'),
    spans,
    links: [],
  };
}

function fixtureExtraction() {
  const pages = [
    page(0, [{ text: 'A RELIABLE BOOK', fontSize: 28, bold: true, x: 180 }, { text: 'By Ada Reader', fontSize: 14, x: 240 }]),
    page(1, ['Copyright © 2026 Ada Reader', 'ISBN 978-1-23456-789-0', 'Published by Example Press']),
    page(2, [{ text: 'CONTENTS', fontSize: 20, bold: true, x: 240 }, 'Chapter One .... 1', 'Chapter Two .... 3', 'Appendix .... 5']),
    page(3, ['A RELIABLE BOOK', { text: 'CHAPTER ONE: BEGINNINGS', fontSize: 20, bold: true, x: 150 }, 'The first sentence begins here. The second sentence ends here.', '3']),
    page(4, ['A RELIABLE BOOK', 'This sentence crosses a PDF', 'page boundary without stopping', 'until this point. A fourth sentence follows.', { text: '1 A small contextual footnote.', fontSize: 7, y: 710 }, '4']),
    page(5, ['A RELIABLE BOOK', { text: 'CHAPTER TWO: CONTINUING', fontSize: 20, bold: true, x: 145 }, 'A new chapter starts cleanly. Its second sentence stays here.', '5']),
    page(6, ['A RELIABLE BOOK', { text: 'APPENDIX A', fontSize: 20, bold: true, x: 230 }, 'Appendix prose remains available. This is its second sentence.', '6']),
    page(7, ['A RELIABLE BOOK', { text: 'REFERENCES', fontSize: 20, bold: true, x: 230 }, 'Reader, A. 2026. A cited work.', '7']),
  ];
  return {
    title: 'A Reliable Book',
    pages: pages.map(({ text }) => text),
    structuredPages: pages,
    metadata: { title: 'A Reliable Book', author: 'Ada Reader' },
    outlines: [
      { title: 'Chapter One: Beginnings', pageIndex: 3, level: 0 },
      { title: 'Chapter Two: Continuing', pageIndex: 5, level: 0 },
      { title: 'Appendix A', pageIndex: 6, level: 0 },
      { title: 'Decorative quotation', pageIndex: 4, level: 1 },
    ],
  };
}

test('structured parser removes running furniture and emits exactly two sentences per card', async () => {
  const parsed = await parseEbook(fixtureExtraction(), 'unhelpful-file-name.pdf');
  assert.equal(parsed.diagnostics.parserVersion, CONTENT_PARSER_VERSION);
  assert.equal(parsed.metadata.title.value, 'A Reliable Book');
  assert.ok(parsed.diagnostics.counts.removedFurniture >= 5);
  assert.ok(parsed.readingUnits.length >= 3);
  assert.ok(parsed.readingUnits.every(unit => unit.sentenceCount === 1 || unit.sentenceCount === 2));
  assert.ok(parsed.readingUnits.every(unit => unit.sentenceCount <= 2));
  assert.ok(parsed.paragraphs.every(text => text !== 'A RELIABLE BOOK' && !/^\d+$/.test(text)));
  assert.ok(parsed.supplements.some(supplement => supplement.kind === 'footnote'));
  assert.ok(parsed.supplements.some(supplement => supplement.kind === 'reference'));
});

test('semantic navigation keeps confirmed structure and suppresses an uncertain outline label', async () => {
  const parsed = await parseEbook(fixtureExtraction(), 'book.pdf');
  const titles = parsed.chapters.map(chapter => chapter.title);
  assert.ok(titles.some(title => /chapter one/i.test(title)));
  assert.ok(titles.some(title => /chapter two/i.test(title)));
  assert.ok(titles.some(title => /appendix/i.test(title)));
  assert.ok(!titles.some(title => /decorative quotation/i.test(title)));
  assert.ok(parsed.diagnostics.suppressedNavigation.some(item => /decorative quotation/i.test(item.title)));
  const first = parsed.readingUnits.find(unit => /first sentence begins/i.test(unit.text));
  const secondChapter = parsed.readingUnits.find(unit => /new chapter starts/i.test(unit.text));
  assert.ok(first && secondChapter);
  assert.notEqual(first.sectionId, secondChapter.sectionId);
});

test('source anchors remap exact positions and reject weak legacy guesses', async () => {
  const parsed = await parseEbook(fixtureExtraction(), 'book.pdf');
  const target = parsed.readingUnits.findIndex(unit => /new chapter starts/i.test(unit.text));
  assert.ok(target >= 0);
  const exact = remapReadingPosition(parsed.readingUnits[target].anchor, parsed.readingUnits);
  assert.equal(exact.index, target);
  assert.ok(exact.confidence >= 0.99);
  const weak = remapReadingPosition(sourceAnchorForLegacy('Completely unrelated prose.', 99), parsed.readingUnits);
  assert.ok(weak.confidence < 0.9);
});

test('native token proposals remain guarded and sections never share a card', async () => {
  const parsed = await parseEbook(fixtureExtraction(), 'book.pdf', async texts =>
    texts.map(text => [...text].flatMap((_character, index) => text[index] === '.' ? [index + 1] : [])));
  assert.ok(parsed.readingUnits.every(unit => unit.sentenceCount <= 2));
  assert.ok(parsed.readingUnits.every(unit => !(/second sentence stays here.*Appendix prose/s.test(unit.text))));
});

test('two-column pages read down the left column before the right column', async () => {
  const title = page(0, [{ text: 'COLUMN BOOK', fontSize: 28, bold: true, x: 190 }]);
  const body = page(1, [
    { text: 'CHAPTER ONE', fontSize: 20, bold: true, x: 48 },
    { text: 'Left sentence begins and', x: 48, y: 150 },
    { text: 'continues on its next line.', x: 48, y: 170 },
    { text: 'Left sentence two begins', x: 48, y: 190 },
    { text: 'and ends in this column.', x: 48, y: 210 },
    { text: 'Right sentence begins and', x: 330, y: 150 },
    { text: 'continues on its next line.', x: 330, y: 170 },
    { text: 'Right sentence two begins', x: 330, y: 190 },
    { text: 'and ends in this column.', x: 330, y: 210 },
  ]);
  body.spans[0].bounds.width = 516;
  const extraction = {
    pages: [title.text, body.text],
    structuredPages: [title, body],
    metadata: { title: 'Column Book' },
    outlines: [{ title: 'Chapter One', pageIndex: 1, level: 0 }],
  };
  const parsed = await parseEbook(extraction, 'column.pdf');
  const readingText = parsed.readingUnits.map(unit => unit.text).join(' ');
  assert.ok(readingText.indexOf('Left sentence two') < readingText.indexOf('Right sentence begins'));
  assert.ok(parsed.readingUnits.every(unit => unit.sentenceCount <= 2));
});
