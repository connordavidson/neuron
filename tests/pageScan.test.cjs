const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadSource } = require('./loadSource.cjs');
const { matchScannedPage, matchScannedPageAsync } = loadSource('src/lib/pageScanMatcher.ts');
const { PageScanSession } = loadSource('src/lib/pageScanSession.ts');
const { ReadingSession, buildReadingOffsets, summaryAtPosition } = loadSource('src/lib/readingPosition.ts');

const opening = 'Before sunrise the old gardener walked through the orchard carrying a wooden basket. She stopped beside the youngest apple tree and examined its branches carefully.';
const passage = 'Beyond the orchard a narrow path followed the river toward an abandoned mill. The water carried silver leaves past the broken wheel while swallows circled above the roof.';
const ending = 'Inside the workshop a carpenter measured a board against the window frame. His apprentice arranged the tools along a shelf and swept the scattered shavings into a bucket.';
const paragraphs = ['Title and copyright', opening, passage, ending];

test('finds the open ebook passage independently of printed pagination', () => {
  assert.deepEqual(matchScannedPage(paragraphs, `THE RIVER\n127\n${passage}\n128`), {
    status: 'matched', paragraphIndex: 2, matchedWords: 28,
  });
});

test('normalizes capitalization, curly apostrophes, accents, ligatures and hyphenated line breaks', () => {
  const text = "The officer's careful observations revealed an extraordinary pattern beneath the café window. Every afternoon the same unfamiliar visitor returned carrying a different collection of flowers from the neighboring garden.";
  const scan = text.toUpperCase().replace('OFFICER\'S', 'OﬃCER’S').replace('EXTRAORDINARY', 'EXTRA-\nORDINARY').replace('CAFÉ', 'CAFE');
  assert.equal(matchScannedPage([opening, text], scan).paragraphIndex, 1);
});

test('tolerates OCR substitutions, missing and inserted words', () => {
  const scan = passage.replace('orchard', '0rchard').replace('narrow ', '')
    .replace('abandoned', 'aband0ned').replace('silver leaves', 'silver stray leaves');
  assert.equal(matchScannedPage(paragraphs, scan).paragraphIndex, 2);
});

test('a scan beginning mid-sentence lands on its containing reading card', () => {
  const scan = `${opening.split(' ').slice(12).join(' ')} ${passage}`;
  assert.equal(matchScannedPage(paragraphs, scan).paragraphIndex, 1);
});

test('matches across many reading cards and respects their first token boundary', () => {
  const tokens = passage.split(' ');
  const cards = [opening, tokens.slice(0, 8).join(' '), '', tokens.slice(8, 17).join(' '), tokens.slice(17).join(' '), ending];
  assert.equal(matchScannedPage(cards, passage).paragraphIndex, 1);
  assert.equal(matchScannedPage(cards, tokens.slice(8).join(' ')).paragraphIndex, 3);
});

test('an isolated header word cannot pull the jump into the previous card', () => {
  assert.equal(matchScannedPage(['The chapter concludes with the word valley.', passage], `VALLEY\n127\n${passage}`).paragraphIndex, 1);
});

test('matches a short final card by using surrounding text', () => {
  assert.equal(matchScannedPage([opening, ...passage.split('. ')], passage).paragraphIndex, 1);
});

test('refuses short, blank, numeric furniture and non-distinct text', () => {
  for (const scan of ['', 'CHAPTER FOUR 43', 'A very short partial sentence', 'the '.repeat(40)]) {
    assert.equal(matchScannedPage(paragraphs, scan).status, 'too-short');
  }
});

test('refuses an unrelated book or materially different wording', () => {
  const scan = 'At the observatory the astronomer adjusted her telescope and recorded the positions of distant planets. A colleague checked the measurements against a chart before closing the shutters for the morning.';
  assert.equal(matchScannedPage(paragraphs, scan).status, 'not-found');
  assert.equal(matchScannedPage([passage], passage.split(' ').map((word, i) => i % 2 ? `changed${i}` : word).join(' ')).status, 'not-found');
  assert.equal(matchScannedPage([], passage).status, 'not-found');
});

test('rejects repeated passages even when both copies share one candidate window', () => {
  for (const gap of ['', ending, `${ending} ${opening}`]) {
    assert.equal(matchScannedPage([opening, passage, gap, passage], passage).status, 'ambiguous');
  }
});

test('rejects near-identical alternatives but consolidates windows for one passage', () => {
  const similar = passage.replace('silver', 'golden');
  assert.equal(matchScannedPage([passage, ending, similar], passage).status, 'ambiguous');
  assert.equal(matchScannedPage([opening, passage, ending], `${passage} ${ending}`).status, 'matched');
});

test('ranks common phrase leads instead of rejecting a clear unique page', () => {
  const common = 'the same ordinary words appear here before the ';
  const decoys = Array.from({ length: 80 }, (_, index) => `${common}unrelated passage ${index} with different ending.`);
  const target = `${common}river turned beneath the abandoned mill while swallows circled above the broken wheel and silver leaves drifted downstream.`;
  assert.equal(matchScannedPage([...decoys, target], target).paragraphIndex, decoys.length);
});

test('long scan with headers and OCR damage still locates the top of the page', () => {
  const page = [opening, passage, ending].join(' ');
  const scan = `A WALK THROUGH THE VALLEY\n${page.split(' ').map((word, i) => i % 11 === 10 ? 'unreadable' : word).join(' ')}\n247`;
  assert.equal(matchScannedPage(['Preface and title', opening, passage, ending], scan).paragraphIndex, 1);
});

test('async matching agrees with fixtures and allows cancellation between batches', async () => {
  assert.deepEqual(await matchScannedPageAsync(paragraphs, passage), matchScannedPage(paragraphs, passage));
  let cancelled = false;
  const pending = matchScannedPageAsync(Array(10000).fill(opening), passage, () => cancelled);
  setTimeout(() => { cancelled = true; }, 0);
  assert.equal(await pending, null);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(scan, extra = {}) {
  const reading = new ReadingSession(3, paragraphs.length);
  const content = { paragraphs, paragraphPages: [0, 4, 8, 9], chapters: [], readingStart: 1, pdfUri: 'file:///book.pdf' };
  const offsets = buildReadingOffsets(content);
  let saved = { id: 'book', currentParagraph: 3, paragraphCount: 4 };
  const jumps = [];
  const states = [];
  const session = new PageScanSession({ paragraphs, scan, currentPosition: () => reading.index,
    jump: index => { jumps.push(index); reading.jump(index); saved = summaryAtPosition(saved, content, offsets, index); },
    onChange: state => states.push(state), ...extra });
  return { session, reading, jumps, states, saved: () => saved };
}

test('automatic jump and Undo use the normal position and persistence pipeline', async () => {
  const h = harness(async () => passage);
  h.session.open();
  await h.session.start();
  assert.equal(h.reading.index, 2);
  assert.equal(h.saved().currentParagraph, 2);
  assert.equal(h.saved().currentSourcePage, 9);
  h.reading.scroll(0, 800);
  assert.equal(h.reading.index, 2);
  const reopened = new ReadingSession(h.saved().currentParagraph, 4);
  assert.equal(reopened.index, 2);
  assert.equal(h.session.state.undoPosition, 3);
  h.session.undo();
  assert.equal(h.saved().currentParagraph, 3);
  assert.equal(h.saved().currentSourcePage, 10);
  assert.deepEqual(h.jumps, [2, 3]);
  assert.equal(h.session.state.undoPosition, undefined);
});

test('camera cancellation, no match and permission errors preserve position and allow retry', async () => {
  for (const scan of [async () => null, async () => 'small scan', async () => { throw Object.assign(new Error('Allow camera access in Settings.'), { code: 'ERR_SCAN_PERMISSION' }); }]) {
    const h = harness(scan);
    await h.session.start();
    assert.equal(h.saved().currentParagraph, 3);
    assert.deepEqual(h.jumps, []);
    assert.equal(h.session.state.busy, false);
    assert.notEqual(h.session.state.phase, 'working');
  }
  const h = harness(async () => { throw Object.assign(new Error('Allow camera access.'), { code: 'ERR_SCAN_PERMISSION' }); });
  await h.session.start();
  assert.equal(h.session.state.notice.openSettings, true);
  assert.equal(h.session.state.notice.message, 'Allow camera access in Settings to scan a book page.');
});

test('native diagnostics and unsupported builds produce user-facing recovery copy', async () => {
  for (const [code, expected] of [
    ['ERR_SCAN_PERMISSION', 'Allow camera access in Settings to scan a book page.'],
    ['ERR_SCAN_REBUILD', 'Rebuild the iOS app to enable page scanning.'],
    ['ERR_SCAN_UNSUPPORTED', 'Page scanning requires a supported physical iPhone or iPad.'],
    ['ERR_SCAN_PAGE_COUNT', 'Scan just one book page, then tap Save.'],
    ['UNKNOWN', 'The scan could not be completed. Please try again.'],
  ]) {
    const h = harness(async () => { throw Object.assign(new Error('undefined reason (at Framework/Promise.swift:65)'), { code }); });
    await h.session.start();
    assert.equal(h.session.state.notice.message, expected);
    assert.deepEqual(h.jumps, []);
  }
});

test('duplicate taps cannot launch two cameras', async () => {
  const capture = deferred();
  let scans = 0;
  const h = harness(() => { scans += 1; return capture.promise; });
  const pending = h.session.start();
  await h.session.start();
  assert.equal(scans, 1);
  capture.resolve(passage);
  await pending;
  assert.deepEqual(h.jumps, [2]);
});

test('cancellation ignores late native results and holds the lock until completion', async () => {
  const capture = deferred();
  const h = harness(() => capture.promise);
  const pending = h.session.start();
  h.session.cancel();
  assert.equal(h.session.state.phase, 'closed');
  assert.equal(h.session.state.busy, true);
  capture.resolve(passage);
  await pending;
  assert.equal(h.session.state.busy, false);
  assert.deepEqual(h.jumps, []);
});

test('closing the reader or replacing its book/layout ignores late matches and notifications', async () => {
  const match = deferred();
  const h = harness(async () => passage, { match: () => match.promise });
  const pending = h.session.start();
  await Promise.resolve();
  h.session.dispose();
  const notifications = h.states.length;
  match.resolve({ status: 'matched', paragraphIndex: 2 });
  await pending;
  assert.deepEqual(h.jumps, []);
  assert.equal(h.states.length, notifications);
});

test('cancelling matching invalidates its result, including late errors', async () => {
  for (const shouldReject of [false, true]) {
    const match = deferred();
    const h = harness(async () => passage, { match: () => match.promise });
    const pending = h.session.start();
    await Promise.resolve();
    h.session.cancel();
    if (shouldReject) match.reject(new Error('Late error'));
    else match.resolve({ status: 'matched', paragraphIndex: 2 });
    await pending;
    assert.equal(h.session.state.phase, 'closed');
    assert.deepEqual(h.jumps, []);
  }
});

test('dismissing Undo or starting a new scan clears the previous return position', async () => {
  const h = harness(async () => passage);
  await h.session.start();
  h.session.dismissUndo();
  h.session.undo();
  assert.deepEqual(h.jumps, [2]);
  await h.session.start();
  h.session.open();
  assert.equal(h.session.state.undoPosition, undefined);
});

test('scanner waits for camera ownership and duplicate taps cannot bypass acquisition', async () => {
  const acquisition = deferred();
  const capture = deferred();
  let scans = 0, acquisitions = 0, releases = 0;
  const h = harness(() => { scans += 1; return capture.promise; }, {
    acquireCamera: () => { acquisitions += 1; return acquisition.promise; },
  });
  const pending = h.session.start();
  await h.session.start();
  assert.equal(acquisitions, 1);
  assert.equal(scans, 0);
  assert.equal(h.session.state.busy, true);
  acquisition.resolve(() => { releases += 1; });
  await Promise.resolve();
  assert.equal(scans, 1);
  assert.equal(releases, 0);
  capture.resolve(passage);
  await pending;
  assert.equal(releases, 1);
  assert.equal(h.session.state.busy, false);
  assert.deepEqual(h.jumps, [2]);
});

for (const action of ['cancel', 'dispose']) {
  test(`${action} while waiting for camera releases a late lease without presenting scanner`, async () => {
    const acquisition = deferred();
    let scans = 0, releases = 0;
    const h = harness(async () => { scans += 1; return passage; }, {
      acquireCamera: () => acquisition.promise,
    });
    const pending = h.session.start();
    h.session[action]();
    const notificationCount = h.states.length;
    assert.equal(h.session.state.busy, true);
    acquisition.resolve(() => { releases += 1; });
    await pending;
    assert.equal(scans, 0);
    assert.equal(releases, 1);
    assert.deepEqual(h.jumps, []);
    if (action === 'dispose') assert.equal(h.states.length, notificationCount);
    else assert.equal(h.session.state.busy, false);
  });
}

test('camera acquisition rejection allows retry without presenting scanner', async () => {
  let scans = 0;
  const h = harness(async () => { scans += 1; return passage; }, {
    acquireCamera: async () => { throw new Error('Camera handoff failed'); },
  });
  await h.session.start();
  assert.equal(scans, 0);
  assert.equal(h.session.state.busy, false);
  assert.equal(h.session.state.phase, 'error');
  assert.deepEqual(h.jumps, []);
});

test('scan and match errors release their camera lease exactly once', async () => {
  for (const failure of ['scan', 'match']) {
    let releases = 0;
    const h = harness(async () => {
      if (failure === 'scan') throw new Error('Camera failed');
      return passage;
    }, {
      acquireCamera: async () => () => { releases += 1; },
      match: async () => { throw new Error('Matching failed'); },
    });
    await h.session.start();
    h.session.cancel();
    h.session.dispose();
    assert.equal(releases, 1);
    assert.equal(h.session.state.busy, false);
    assert.deepEqual(h.jumps, []);
  }
});

for (const action of ['cancel', 'dispose']) {
  test(`${action} of an active scan keeps camera ownership until native capture settles`, async () => {
    const capture = deferred();
    let releases = 0;
    const h = harness(() => capture.promise, { acquireCamera: async () => () => { releases += 1; } });
    const pending = h.session.start();
    await Promise.resolve();
    h.session[action]();
    const notificationCount = h.states.length;
    assert.equal(releases, 0);
    assert.equal(h.session.state.busy, true);
    capture.reject(new Error('Late camera error'));
    await pending;
    assert.equal(releases, 1);
    if (action === 'dispose') assert.equal(h.states.length, notificationCount);
    else {
      assert.equal(h.session.state.busy, false);
      assert.equal(h.session.state.phase, 'closed');
    }
  });
}

test('scan control reports modal and pending-camera activity, then resets on cleanup', async () => {
  const { createRenderer, nativeMock, settle } = require('./helpers/render.cjs');
  const renderer = createRenderer();
  const native = nativeMock();
  native.AccessibilityInfo = { announceForAccessibility() {} };
  const capture = deferred();
  const activity = [];
  let releases = 0;
  const { PageScanControl } = loadSource('src/components/PageScanControl.tsx', {
    react: renderer.react,
    'react-native': native,
    'modules/pdf-text-extractor/src/PDFTextExtractorModule.ts': { scanBookPage: () => capture.promise },
  });
  renderer.mount(PageScanControl, {
    bookId: 'book', bookTitle: 'Garden', paragraphs, currentPosition: () => 0, onJump() {},
    visible: true, hiddenByPanel: false, opacity: new native.Animated.Value(1), disabled: false,
    theme: { foreground: '#000', background: '#fff', secondary: '#666' },
    acquireCamera: async () => () => { releases += 1; },
    onActivityChange: active => activity.push(active),
  });
  renderer.nodes().find(node => node.props.accessibilityLabel === 'Scan page').props.onPress();
  assert.equal(activity.at(-1), true);
  const cameraButton = renderer.nodes().find(node => node.type === 'Pressable'
    && node.props.children?.some(child => child?.props?.children?.includes('Open camera')));
  cameraButton.props.onPress();
  await settle();
  renderer.nodes().find(node => node.type === 'Modal').props.onRequestClose();
  assert.equal(activity.at(-1), true, 'closed modal remains active while capture is busy');
  capture.resolve(null);
  await settle();
  assert.equal(activity.at(-1), false);
  assert.equal(releases, 1);
  renderer.nodes().find(node => node.props.accessibilityLabel === 'Scan page').props.onPress();
  assert.equal(activity.at(-1), true);
  renderer.unmount();
  assert.equal(activity.at(-1), false);
});
