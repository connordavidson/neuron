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
    const y = typeof line === 'string' ? (/^\d+$/.test(line) ? 750 : 80 + lineIndex * 18) : line.y ?? 80 + lineIndex * 18;
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
  // pdfplumber and PDFKit can assign both columns a shared baseline index.
  for (let index = 5; index < body.spans.length; index++) body.spans[index].lineIndex = index - 4;
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

test('title reconstruction joins wrapped cover lines and ignores production metadata and series labels', async () => {
  const cover = page(0, [
    { text: 'Lecture Notes in Testing', fontSize: 18, y: 25 },
    { text: 'Alex Reader · Editor', fontSize: 20, y: 90 },
    { text: 'Uncertainty in', fontSize: 50, y: 180 },
    { text: 'Complex Systems', fontSize: 50, y: 235 },
  ]);
  const parsed = await parseEbook({ pages: [cover.text], structuredPages: [cover], metadata: { title: '123456_En_Print.indd' } }, 'upload.pdf');
  assert.equal(parsed.metadata.title.value, 'Uncertainty in Complex Systems');
});

test('repeated interior title separates a same-size cover subtitle from the book name', async () => {
  const cover = page(0, [
    { text: 'Animating Change', fontSize: 24, y: 200 },
    { text: 'A Study of Motion', fontSize: 24, y: 230 },
    { text: 'Alex Reader', fontSize: 16, y: 290 },
  ]);
  const title = page(1, [
    { text: 'Alex Reader', fontSize: 16, y: 80 },
    { text: 'Animating Change', fontSize: 32, y: 150 },
    { text: 'A Study of Motion', fontSize: 14, y: 220 },
  ]);
  const parsed = await parseEbook({ pages: [cover.text, title.text], structuredPages: [cover, title] }, 'file.pdf');
  assert.equal(parsed.metadata.title.value, 'Animating Change');
});

test('font changes inside words do not insert spaces', async () => {
  const body = page(0, [{ text: 'CHAPTER ONE', fontSize: 20 }, 'Neurochemical activity continues. Another sentence follows.']);
  const original = body.spans[1];
  const prefix = { ...original, text: 'Neuro', sourceEnd: original.sourceStart + 5, bounds: { ...original.bounds, width: 25 } };
  const suffix = { ...original, text: original.text.slice(5), sourceStart: prefix.sourceEnd,
    italic: true, bounds: { ...original.bounds, x: original.bounds.x + 25, width: original.bounds.width - 25 } };
  body.spans.splice(1, 1, prefix, suffix);
  const parsed = await parseEbook({ pages: [body.text], structuredPages: [body] }, 'book.pdf');
  assert.match(parsed.paragraphs.join(' '), /Neurochemical activity/);
});

test('wrapped unnumbered outline chapter restores prose after a previous bibliography', async () => {
  const pages = [
    page(0, [{ text: 'CHAPTER ONE', fontSize: 20 }, 'One begins. Two ends.']),
    page(1, [{ text: 'References', fontSize: 20 }, 'Reader, A. A citation.']),
    page(2, [{ text: 'A Different Kind', fontSize: 20 }, { text: 'of Beginning', fontSize: 20 }, 'Body text returns here. It must remain readable.']),
  ];
  const parsed = await parseEbook({ pages: pages.map(p => p.text), structuredPages: pages,
    outlines: [{ title: 'A Different Kind of Beginning', pageIndex: 2, level: 0 }] }, 'book.pdf');
  assert.ok(parsed.chapters.some(c => c.title === 'A Different Kind of Beginning'));
  assert.match(parsed.paragraphs.join(' '), /Body text returns here/);
  const citation = parsed.readingUnits.find(unit => unit.text.includes('A citation'));
  assert.equal(parsed.sections.find(section => section.id === citation?.sectionId)?.kind, 'bibliography');
  assert.notEqual(citation?.sectionId, parsed.readingUnits.find(unit => unit.text.includes('Body text returns here'))?.sectionId);
});

test('chapter-local running headers are removed without requiring a quarter of the whole book', async () => {
  const pages = Array.from({ length: 24 }, (_, index) => page(index, [
    { text: index < 4 ? 'First chapter running header' : 'Later chapter running header', fontSize: 10, y: 25 },
    ...(index === 0 ? [{ text: 'CHAPTER ONE', fontSize: 20, y: 140 }] : []),
    { text: 'The narrative continues normally. A second sentence follows.', y: 200 },
  ]));
  const parsed = await parseEbook({ pages: pages.map(p => p.text), structuredPages: pages }, 'book.pdf');
  assert.ok(!parsed.paragraphs.join(' ').includes('running header'));
  assert.equal(parsed.diagnostics.counts.removedFurniture, 24);
});

test('the word index in a body sentence does not start an index section', async () => {
  const body = page(0, [{ text: 'CHAPTER ONE', fontSize: 20 },
    'The index reflects a change', 'in the results. The story continues.', 'References to these findings appear later.']);
  const parsed = await parseEbook({ pages: [body.text], structuredPages: [body] }, 'book.pdf');
  assert.ok(!parsed.sections.some(s => ['index', 'bibliography'].includes(s.kind)));
  assert.match(parsed.paragraphs.join(' '), /References to these findings/);
});

test('outline bylines and invisible PDF separators do not hide the next chapter', async () => {
  const pages = [page(0, [{ text: 'References', fontSize: 20 }, 'A citation stays secondary.']),
    page(1, [{ text: 'How Can Systems Change?', fontSize: 20 }, 'New prose must be retained. Another sentence follows.'])];
  const parsed = await parseEbook({ pages: pages.map(p => p.text), structuredPages: pages,
    outlines: [{ title: 'How Can Sys\uFEFFtems Change? (Alex Reader)', pageIndex: 1, level: 0 }] }, 'book.pdf');
  assert.ok(parsed.chapters.some(c => c.title.includes('How Can Systems Change?')));
  assert.match(parsed.paragraphs.join(' '), /New prose must be retained/);
});

test('small abstract text does not turn adjacent normal body lines into headings', async () => {
  const pages = [page(0, [{ text: 'CHAPTER ONE', fontSize: 20 },
    'The ordinary body has enough characters to establish the document style. It continues here.']),
    page(1, [
      ...Array.from({ length: 8 }, (_, i) => ({ text: 'Abstract material in small type. It is smaller than the main body.', fontSize: 9, y: 90 + i * 12 })),
      { text: 'This ordinary body line must not become a heading', fontSize: 11, y: 250 },
      { text: 'merely because the abstract is printed smaller. The body continues.', fontSize: 11, y: 268 },
    ]),
    ...Array.from({ length: 4 }, (_, i) => page(i + 2, ['More ordinary body material establishes the dominant document font. It continues here.'])),
  ];
  const parsed = await parseEbook({ pages: pages.map(p => p.text), structuredPages: pages }, 'book.pdf');
  assert.match(parsed.paragraphs.join(' '), /This ordinary body line must not become a heading merely because/);
});

test('metadata can reconcile a short title printed in different font sizes', async () => {
  const cover = page(0, [{ text: 'Made of', fontSize: 36, x: 160, y: 80 },
    { text: 'Clay', fontSize: 90, x: 300, y: 120 }]);
  const parsed = await parseEbook({ pages: [cover.text], structuredPages: [cover], metadata: { title: 'Made of Clay' } }, 'book.pdf');
  assert.equal(parsed.metadata.title.value, 'Made of Clay');
});

test('a narrow repeated gutter still separates columns without treating ordinary word gaps as gutters', async () => {
  const body = page(0, [{ text: 'CHAPTER ONE', fontSize: 20, y: 80 },
    ...Array.from({ length: 4 }, (_, i) => ({ text: `Left column line ${i} continues here.`, x: 48, y: 150 + i * 20 })),
    ...Array.from({ length: 4 }, (_, i) => ({ text: `Right column line ${i} continues here.`, x: 300, y: 150 + i * 20 })),
  ]);
  body.spans[0].bounds.width = 516;
  for (let i = 1; i <= 4; i++) body.spans[i].bounds.width = 240;
  for (let i = 5; i <= 8; i++) body.spans[i].lineIndex = i - 4;
  const parsed = await parseEbook({ pages: [body.text], structuredPages: [body] }, 'book.pdf');
  const text = parsed.paragraphs.join(' ');
  assert.ok(text.indexOf('Left column line 3') < text.indexOf('Right column line 0'));

  const plain = page(0, [{ text: 'CHAPTER ONE', fontSize: 20 }, 'Wide word spacing must stay together. Another sentence follows.']);
  const span = plain.spans[1];
  plain.spans.splice(1, 1, { ...span, text: 'Wide', sourceEnd: span.sourceStart + 4, bounds: { ...span.bounds, width: 20 } },
    { ...span, text: span.text.slice(5), sourceStart: span.sourceStart + 5, bounds: { ...span.bounds, x: span.bounds.x + 32 } });
  const single = await parseEbook({ pages: [plain.text], structuredPages: [plain] }, 'book.pdf');
  assert.match(single.paragraphs.join(' '), /Wide word spacing must stay together/);
});

test('copyright and contents remain readable, but first open starts at the introduction', async () => {
  const pages = [
    page(0, [{ text: 'Also by Alex Reader', fontSize: 20 }, 'An earlier work. Another earlier work.']),
    page(1, [{ text: 'Copyright', fontSize: 20 }, 'Copyright belongs to the author. All rights are reserved.']),
    page(2, [{ text: 'Contents', fontSize: 20 }, 'Introduction .... 1', 'Chapter One .... 2']),
    page(3, [{ text: 'Introduction', fontSize: 20 }, 'This is the actual beginning. The second sentence follows.']),
    page(4, [{ text: 'Chapter One', fontSize: 20 }, 'The main chapter begins. Its second sentence follows.']),
    page(5, [{ text: 'Notes', fontSize: 20 }, 'A contextual note is available. Another note follows.']),
  ];
  const parsed = await parseEbook({ pages: pages.map(p => p.text), structuredPages: pages,
    outlines: [{ title: 'Introduction', pageIndex: 3, level: 0 }, { title: 'Chapter One', pageIndex: 4, level: 0 }, { title: 'Notes', pageIndex: 5, level: 0 }] }, 'book.pdf');
  const copyright = parsed.chapters.find(c => c.title === 'Copyright');
  assert.ok(copyright && copyright.paragraphIndex < parsed.readingStart);
  assert.ok(parsed.chapters.some(c => c.title === 'Contents'));
  assert.match(parsed.paragraphs[parsed.readingStart], /This is the actual beginning/);
  assert.match(parsed.paragraphs.join(' '), /Copyright belongs to the author/);
  assert.ok(parsed.chapters.some(c => c.title === 'Notes'));
  const { buildReadingOffsets, summaryAtPosition } = loadSource('src/lib/readingPosition.ts');
  const offsets = buildReadingOffsets(parsed);
  const summary = summaryAtPosition({ id: 'test', currentParagraph: copyright.paragraphIndex }, parsed, offsets);
  assert.equal(summary.currentParagraph, copyright.paragraphIndex);
  assert.equal(summary.readingProgress, 0);
  const notes = parsed.chapters.find(c => c.title === 'Notes');
  assert.equal(offsets[notes.paragraphIndex], offsets.at(-1));
});

test('numbered outline titles match separate ordinal and title typography without inventing prose chapters', async () => {
  const names = ['One', 'Two', 'Three'];
  const titles = ['The Beginning', 'A Second Stage', 'The Final Stage'];
  const pages = names.map((name, index) => page(index, [
    { text: name, fontSize: 15, y: 130 },
    { text: titles[index].replace('Stage', 'S tage'), fontSize: 28, y: 170 },
    { text: 'The story starts in this chapter. It continues in the next sentence.', y: 280 },
    { text: 'chapter 15: if somebody mentions this topic in passing,', y: 330 },
    { text: 'it is not a new heading. More ordinary text follows.', y: 350 },
  ]));
  const parsed = await parseEbook({ pages: pages.map(p => p.text), structuredPages: pages,
    outlines: names.map((name, index) => ({ title: `${name}: ${titles[index]}`, pageIndex: index, level: 0 })) }, 'book.pdf');
  assert.deepEqual(parsed.chapters.filter(c => c.kind === 'chapter').map(c => c.title), names.map((name, index) => `${name}: ${titles[index]}`));
  assert.ok(!parsed.chapters.some(c => c.title.includes('somebody')));
});

function textOnlyChapterFixture() {
  return {
    title: 'A Book With Chapters',
    pages: [
      'Contents\nOne THE BEGINNING\nTwo THE NEXT STAGE\nThree WHAT COMES AFTER?',
      'One\nThe Beginning\nThe first chapter starts here. Another sentence follows.',
      'PART I: A CLOSER LOOK\nThis is still the first chapter. The discussion continues.',
      'Two\nThe Next S tage\nThe second chapter starts here. Another sentence follows.',
      'Three\nWhat Comes\nAfter?\nThe final chapter starts here. Another sentence follows.',
    ],
    outlines: [
      { title: 'Contents', pageIndex: 0, level: 0 },
      { title: 'One: THE BEGINNING', pageIndex: 1, level: 0 },
      { title: 'Two: THE NEXT STAGE', pageIndex: 3, level: 0 },
      { title: 'Three: WHAT COMES AFTER?', pageIndex: 4, level: 0 },
    ],
  };
}

test('text-only extraction confirms split numbered chapter titles at their bookmark destinations', async () => {
  const extraction = textOnlyChapterFixture();
  const parsed = await parseEbook(extraction, 'book.pdf');
  const chapters = parsed.chapters.filter(c => c.kind === 'chapter');
  assert.deepEqual(chapters.map(c => [c.title, c.pageIndex]), extraction.outlines.slice(1).map(c => [c.title, c.pageIndex]));
  assert.ok(!parsed.chapters.some(c => c.kind === 'part'));
  assert.ok(parsed.diagnostics.suppressedNavigation.some(c => /internal part heading/.test(c.reason)));
  const insidePart = parsed.readingUnits.find(u => u.text.includes('This is still the first chapter'));
  assert.ok(insidePart);
  assert.equal(insidePart.sectionId, chapters[0].sectionId);
  assert.ok(parsed.paragraphs.join(' ').includes('The second chapter starts here.'));
  const { buildReadingOffsets, chapterProgressMarkers } = loadSource('src/lib/readingPosition.ts');
  const offsets = buildReadingOffsets(parsed);
  assert.deepEqual(chapterProgressMarkers(parsed, offsets), [...chapters.map(c => offsets[c.paragraphIndex] / offsets.at(-1)), 1]);
});

test('complete chapter outlines keep internal Part headings out of structured navigation too', async () => {
  const extraction = textOnlyChapterFixture();
  const structuredPages = extraction.pages.map((text, index) => page(index,
    text.split('\n').map((text, lineIndex) => ({ text, fontSize: lineIndex < 2 ? 24 : 11, y: 100 + lineIndex * 40 }))));
  const parsed = await parseEbook({ ...extraction, structuredPages }, 'book.pdf');
  assert.equal(parsed.chapters.filter(c => c.kind === 'chapter').length, 3);
  assert.ok(!parsed.chapters.some(c => c.kind === 'part'));
  assert.ok(parsed.paragraphs.join(' ').includes('This is still the first chapter.'));
});

test('bookmarked top-level parts remain navigable', async () => {
  const extraction = textOnlyChapterFixture();
  extraction.outlines.push({ title: 'PART I: A CLOSER LOOK', pageIndex: 2, level: 0 });
  const parsed = await parseEbook(extraction, 'book.pdf');
  assert.ok(parsed.chapters.some(c => c.kind === 'part' && c.pageIndex === 2));
});

test('a numbered outline with an incorrect destination is not accepted on numbering alone', async () => {
  const extraction = textOnlyChapterFixture();
  extraction.pages[4] = 'This paragraph mentions What Comes After? It is prose, not the promised chapter heading.';
  const parsed = await parseEbook(extraction, 'book.pdf');
  assert.ok(!parsed.chapters.some(c => c.title === 'Three: WHAT COMES AFTER?'));
  assert.ok(parsed.diagnostics.suppressedNavigation.some(c => c.title === 'Three: WHAT COMES AFTER?' && c.confidence < 0.62));
});

test('contextual supplements still attach to their own section with indexed lookup', async () => {
  const parsed = await parseEbook(fixtureExtraction(), 'book.pdf');
  for (const supplement of parsed.supplements) {
    const block = parsed.blocks.find(b => supplement.relatedBlockIds.includes(b.id));
    const unit = parsed.readingUnits.find(u => supplement.relatedBlockIds.includes(u.id));
    assert.ok(unit);
    if (parsed.readingUnits.some(u => u.sectionId === block.sectionId)) assert.equal(unit.sectionId, block.sectionId);
    assert.ok(unit.supplementIds.includes(supplement.id));
  }
});

test('dedicated credits and notes retain small print in the main flow', async () => {
  const pages = [
    page(0, [{ text: 'Chapter One', fontSize: 20 }, 'The story begins. Another sentence follows.']),
    page(1, [{ text: 'Notes', fontSize: 20 }, { text: 'Small-print note remains readable. Another note follows.', fontSize: 8, y: 700 }]),
    page(2, [{ text: 'Illustration Credits', fontSize: 12 }, { text: 'Illustrations belong to their creators. Images used with permission.', fontSize: 8, y: 700 }]),
  ];
  const parsed = await parseEbook({ pages: pages.map(p => p.text), structuredPages: pages }, 'book.pdf');
  assert.match(parsed.paragraphs.join(' '), /Small-print note remains readable/);
  assert.match(parsed.paragraphs.join(' '), /Images used with permission/);
  assert.ok(parsed.chapters.some(c => c.title === 'Illustration Credits'));
  assert.equal(parsed.readingStart, 0);
});

test('large chapter entries in contents do not replace metadata when the cover is an image', async () => {
  const pages = [page(0, []), page(1, [{ text: 'Contents', fontSize: 12 },
    { text: 'One THE BEGINNING', fontSize: 20 }, { text: 'Two THE JOURNEY', fontSize: 20 }])];
  const parsed = await parseEbook({ pages: pages.map(p => p.text), structuredPages: pages,
    metadata: { title: 'A Book about Journeys' } }, 'upload.pdf');
  assert.equal(parsed.metadata.title.value, 'A Book about Journeys');
});
