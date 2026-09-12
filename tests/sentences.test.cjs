const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./loadSource.cjs');
const { sentenceSpans, splitSentences } = loadSource('src/lib/sentences.ts');
const { paragraphizePagesWithMetadata, paragraphizeWithTokenizer } = loadSource('src/lib/paragraphize.ts');
const { isHorizontalSwipe, swipeOffset, shouldRevealDelete } = loadSource('src/lib/swipeBook.ts');

const excerpt = '"... because of the gene that codes for the particular version of neurochemical Y ."';
test('Apple tokenizer outputs are filtered without losing real sentence boundaries', () => {
  // Recorded from NLTokenizer on the tested Apple runtime, including whitespace.
  const cases = [
    [excerpt + ' Another sentence follows.', [85, 110]],
    [excerpt.replace('...', '. . .') + ' Another sentence follows.', [87, 112]],
    ['Dr. Smith met J. R. Jones at 3.14 meters. Another sentence follows.', [17, 20, 42, 67]],
    ['“Really?” she asked. Another sentence follows.', [10, 21, 46]],
  ];
  for (const [text, ends] of cases) {
    assert.deepEqual(sentenceSpans(text, ends).map(s => s.text), splitSentences(text));
    assert.equal(sentenceSpans(text, ends).length, 2);
  }
});
test('exact reported quotation is one sentence, including leading ellipsis and closing quote', () => {
  for (const dots of ['...', '. . .', '.\u00a0.\u00a0.', '…', '.\n.\n.']) {
    const quote = excerpt.replace('...', dots);
    assert.deepEqual(splitSentences(quote), [quote]);
    assert.deepEqual(splitSentences(`${quote} The next sentence follows.`), [quote, 'The next sentence follows.']);
  }
});

test('pauses, omitted text, and dialogue attribution are not extra sentences', () => {
  for (const text of ['She paused ... then spoke.', 'She paused . . . then spoke.', 'She paused … then spoke.', '“Really?” she asked.', 'Dr. Smith met J. R. Jones at 3.14 meters.']) {
    assert.deepEqual(splitSentences(`${text} Another sentence follows.`), [text, 'Another sentence follows.']);
  }
  assert.deepEqual(splitSentences('“Wait...” She stopped. “What?!” He ran.'), ['“Wait...”', 'She stopped.', '“What?!”', 'He ran.']);
});

test('ellipsis split by PDF line and page breaks stays in one two-sentence card', () => {
  const pages = ['".\n.\n. because of the gene that codes for', 'the particular version of neurochemical Y ."\nThe next sentence follows.'];
  const cards = paragraphizePagesWithMetadata(pages);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].text, excerpt.replace('...', '. . .') + ' The next sentence follows.');
  assert.equal(cards[0].pageIndex, 0);
});

test('ordinary sentence fragments continue across PDF pages before pairing', () => {
  const cards = paragraphizePagesWithMetadata(['The first sentence continues', 'on this PDF page. The second sentence ends here. Third sentence. Fourth sentence.']);
  assert.deepEqual(cards.map(c => c.text), ['The first sentence continues on this PDF page. The second sentence ends here.', 'Third sentence. Fourth sentence.']);
  assert.deepEqual(cards.map(c => c.pageIndex), [0, 1]);
});

test('native boundary proposals inside dots are rejected; UTF-16 quote ends are retained', async () => {
  const text = `🧬 ${excerpt} Another sentence follows.`;
  const quoteEnd = text.indexOf('"', 5) + 1;
  const proposals = [5, 6, 7, quoteEnd, text.length];
  assert.equal(sentenceSpans(text, proposals).length, 2);
  let received;
  const cards = await paragraphizeWithTokenizer([text], [], async texts => { received = texts; return [proposals]; });
  assert.deepEqual(received, [text]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].text, text);
});

test('native tokenizer sees continuous chapter text and cannot join adjacent chapters', async () => {
  const chapters = [{ pageIndex: 0, lineIndex: 0, endLineIndex: 1, title: 'Chapter 1' }, { pageIndex: 2, lineIndex: 0, endLineIndex: 1, title: 'Chapter 2' }];
  const cards = await paragraphizeWithTokenizer(['Chapter 1\nThis thought continues', 'across a page.', 'Chapter 2\nA different thought begins.'], chapters, async texts => {
    assert.deepEqual(texts, ['This thought continues across a page.', 'A different thought begins.']);
    return texts.map(text => [text.length]);
  });
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map(c => c.pageIndex), [0, 2]);
});

test('an older native development build can fall back without an import error', async () => {
  const text = 'First sentence. Second sentence.';
  const records = await paragraphizeWithTokenizer([text], [], async texts =>
    texts.map(value => sentenceSpans(value).map(span => span.start + span.text.length)));
  assert.equal(records[0].text, text);
});

test('horizontal delete gestures do not capture vertical scrolling or small taps', () => {
  assert.equal(isHorizontalSwipe(-60, 5), true);
  assert.equal(isHorizontalSwipe(-5, 60), false);
  assert.equal(isHorizontalSwipe(-8, 2), false);
  assert.equal(isHorizontalSwipe(-20, 20), false);
  assert.equal(swipeOffset(0, -400), -88);
  assert.equal(swipeOffset(-88, 200), 0);
  assert.equal(shouldRevealDelete(-60, 0), true);
  assert.equal(shouldRevealDelete(-10, 0), false);
  assert.equal(shouldRevealDelete(-60, 0.8), false);
});
