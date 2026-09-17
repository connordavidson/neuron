const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./loadSource.cjs');
const { generateReadingUnits, makeSourceAnchor, remapReadingPosition } = loadSource('src/lib/readingUnits.ts');

function sentence(count, prefix = 'Word') {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(' ') + '.';
}

function passage(parts, sectionId = 'chapter-one') {
  let text = '';
  const segments = parts.map((part, pageIndex) => {
    if (text) text += ' ';
    const start = text.length;
    text += part;
    return { start, end: text.length,
      block: { anchor: makeSourceAnchor(pageIndex, String(pageIndex + 1), 100, 100 + part.length, part) } };
  });
  return { text, segments, section: { id: sectionId, title: sectionId } };
}

test('pairs below and at 32 words remain together; 33-word pairs split without shifting later pairs', () => {
  for (const count of [15, 16, 17]) {
    const first = sentence(16, 'First');
    const second = sentence(count, 'Second');
    const tail = 'Third sentence. Fourth sentence. Final sentence.';
    const input = passage([`${first} ${second} ${tail}`]);
    const units = generateReadingUnits([input], []);
    assert.deepEqual(units.map(unit => unit.text), [
      ...(count <= 16 ? [`${first} ${second}`] : [first, second]),
      'Third sentence. Fourth sentence.', 'Final sentence.',
    ]);
    assert.equal(units.map(unit => unit.text).join(' '), input.text);
    assert.deepEqual(units.map(unit => unit.sentenceCount), count <= 16 ? [2, 2, 1] : [1, 1, 2, 1]);
    assert.ok(units.every(unit => unit.sentenceCount === 1 || unit.wordCount <= 32));
  }
});

test('word budget counts mixed whitespace consistently', () => {
  const first = sentence(16).replaceAll(' ', '\t');
  const second = sentence(16, 'Next').replaceAll(' ', '\u00a0');
  const units = generateReadingUnits([passage([first, second])], []);
  assert.equal(units.length, 1);
  assert.equal(units[0].wordCount, 32);
});

test('a split pair retains cross-page source ranges, quotes, headings and section boundaries', () => {
  const first = `“${sentence(20, 'First')}”`;
  const second = sentence(20, 'Second');
  const cut = first.indexOf(' ', 40);
  const partOne = first.slice(0, cut);
  const partTwo = `${first.slice(cut + 1)} ${second}`;
  const input = passage([partOne, partTwo]);
  const next = passage(['Next chapter alone.'], 'chapter-two');
  const units = generateReadingUnits([input, next], [[first.length, input.text.length], [next.text.length]]);
  assert.deepEqual(units.map(unit => unit.text), [first, second, next.text]);
  assert.deepEqual(units.map(unit => unit.id), ['unit-0', 'unit-1', 'unit-2']);
  assert.deepEqual(units.map(unit => unit.heading), ['chapter-one', undefined, 'chapter-two']);
  assert.deepEqual(units.map(unit => unit.sectionId), ['chapter-one', 'chapter-one', 'chapter-two']);
  assert.deepEqual(units.map(unit => unit.sourcePages), [[0, 1], [1], [0]]);
  assert.equal(units[0].anchor.sourceStart, 100);
  assert.equal(units[0].endAnchor.pageIndex, 1);
  assert.equal(units[0].endAnchor.sourceStart, 100 + first.length - cut - 1);
  assert.equal(units[1].anchor.sourceStart, 100 + first.length - cut);
  assert.equal(units[1].endAnchor.sourceStart, 100 + partTwo.length);
  for (const unit of units) {
    assert.equal(unit.sentences[0].text, unit.text);
    assert.deepEqual(unit.sentences[0].anchor, unit.anchor);
    assert.deepEqual(unit.sentences[0].endAnchor, unit.endAnchor);
  }
});

test('long single sentences stay complete with and without a following sentence', () => {
  const long = sentence(90);
  for (const text of [long, `${long} Next sentence.`]) {
    const units = generateReadingUnits([passage([text])], []);
    assert.equal(units[0].text, long);
    assert.equal(units[0].wordCount, 90);
    assert.equal(units[0].sentenceCount, 1);
    assert.equal(units.map(unit => unit.text).join(' '), text);
  }
});

test('reparsing a split pair restores its start only when source coordinates and text agree', () => {
  const input = passage([`${sentence(16, 'First')} ${sentence(17, 'Second')}`]);
  const units = generateReadingUnits([input], []);
  const oldAnchor = makeSourceAnchor(0, '1', 100, 100 + input.text.length, input.text);
  const restored = remapReadingPosition(oldAnchor, units);
  assert.equal(restored.index, 0);
  assert.ok(restored.confidence >= 0.9);
  assert.ok(remapReadingPosition({ ...oldAnchor, sourceStart: 101 }, units).confidence < 0.9);
  assert.ok(remapReadingPosition({ ...oldAnchor, pageIndex: 1 }, units).confidence < 0.9);
  assert.ok(remapReadingPosition(makeSourceAnchor(0, '1', 100, 200, 'Entirely different text.'), units).confidence < 0.9);
  assert.ok(remapReadingPosition(oldAnchor, [units[0], { ...units[0], id: 'duplicate' }]).confidence < 0.9);
});
