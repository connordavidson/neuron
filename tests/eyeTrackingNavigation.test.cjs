const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadSource } = require('./loadSource.cjs');
const { createRenderer, nativeMock } = require('./helpers/render.cjs');

const event = y => ({ nativeEvent: { contentOffset: { y } } });

function harness(initial = 0) {
  const renderer = createRenderer();
  const native = nativeMock();
  const saved = [], jumps = [], frames = new Map();
  let nextFrameID = 0, current;
  const { useReaderNavigation } = loadSource('src/hooks/useReaderNavigation.ts', {
    react: renderer.react,
    'react-native': native,
    $globals: {
      requestAnimationFrame: callback => { frames.set(++nextFrameID, callback); return nextFrameID; },
      cancelAnimationFrame: id => frames.delete(id),
    },
  });
  const paragraphs = ['One.', 'Two.', 'Three.', 'Four.'];
  renderer.mount(function Navigation() {
    current = useReaderNavigation({ currentParagraph: initial }, { paragraphs }, index => saved.push(index));
    return null;
  });
  const nav = () => { renderer.render(); return current; };
  nav().listRef.current = { scrollToIndex: options => jumps.push(options) };
  const layout = (width = 390, height = 800) => {
    nav().onLayout({ nativeEvent: { layout: { width, height } } });
    nav();
  };
  const content = () => nav().onContentSizeChange(nav().viewport.width, nav().pageHeight * paragraphs.length);
  const frame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback());
    nav();
  };
  const settle = () => { frame(); frame(); };
  return { nav, layout, content, frame, settle, frames, saved, jumps, renderer, native };
}

test('initial page settles after native content mount and two frames without needing a scroll event', () => {
  for (const initial of [0, 2]) {
    const h = harness(initial);
    assert.equal(h.nav().settledParagraph, null);
    h.layout();
    h.settle();
    assert.equal(h.nav().settledParagraph, null);
    h.content();
    h.frame();
    assert.equal(h.nav().settledParagraph, null);
    h.frame();
    assert.equal(h.nav().settledParagraph, initial);
    assert.deepEqual(h.saved, [], 'mounting must not overwrite stored reading progress');
    h.renderer.unmount();
  }
});

test('drag invalidates immediately and a no-momentum drag settles only on a stable aligned offset', () => {
  const h = harness();
  h.layout(); h.content(); h.settle();
  h.nav().onScrollBeginDrag(event(0));
  assert.equal(h.nav().settledParagraph, null);
  h.nav().commitScrollOffset(event(450));
  assert.equal(h.nav().currentParagraph, 1, 'progress keeps its existing nearest-page semantics');
  h.nav().onScrollEndDrag(event(450));
  h.settle();
  assert.equal(h.nav().settledParagraph, null, 'midway offsets never become gaze targets');
  h.nav().commitScrollOffset(event(800));
  h.frame();
  assert.equal(h.nav().settledParagraph, null);
  h.frame();
  assert.equal(h.nav().settledParagraph, 1);
  assert.deepEqual(h.saved, [1]);
  h.renderer.unmount();
});

test('momentum cancels drag-end settlement and waits for momentum end', () => {
  const h = harness();
  h.layout(); h.content(); h.settle();
  h.nav().onScrollBeginDrag(event(0));
  h.nav().onScrollEndDrag(event(800));
  h.frame();
  h.nav().onMomentumScrollBegin(event(800));
  h.settle();
  assert.equal(h.nav().settledParagraph, null);
  h.nav().commitScrollOffset(event(1600));
  h.settle();
  assert.equal(h.nav().settledParagraph, null, 'an aligned offset while moving is insufficient');
  h.nav().onMomentumScrollEnd(event(1600));
  h.settle();
  assert.equal(h.nav().settledParagraph, 2);
  assert.equal(h.saved.at(-1), 2);
  h.renderer.unmount();
});

test('new scroll offsets restart the two-frame stability check', () => {
  const h = harness();
  h.layout(); h.content(); h.settle();
  h.nav().onScrollBeginDrag(event(0));
  h.nav().onScrollEndDrag(event(800));
  h.frame();
  h.nav().commitScrollOffset(event(1600));
  h.frame();
  assert.equal(h.nav().settledParagraph, null);
  h.frame();
  assert.equal(h.nav().settledParagraph, 2);
  h.renderer.unmount();
});

test('nonanimated jumps invalidate immediately and settle even when native emits no scroll event', () => {
  const h = harness();
  h.layout(); h.content(); h.settle();
  h.nav().jumpToPosition(2);
  assert.equal(h.nav().settledParagraph, null);
  assert.equal(h.nav().currentParagraph, 2);
  h.settle();
  assert.equal(h.nav().settledParagraph, 2);
  h.nav().jumpToPosition(2);
  assert.equal(h.nav().settledParagraph, null);
  h.settle();
  assert.equal(h.nav().settledParagraph, 2);
  assert.deepEqual(h.jumps, [{ animated: false, index: 2 }, { animated: false, index: 2 }]);
  assert.deepEqual(h.saved, [2, 2]);
  h.renderer.unmount();
});

test('observed offsets override provisional jumps and cannot settle a different page', () => {
  const h = harness();
  h.layout(); h.content(); h.settle();
  h.nav().jumpToPosition(3);
  h.nav().commitScrollOffset(event(800));
  h.settle();
  assert.equal(h.nav().settledParagraph, null);
  assert.equal(h.nav().currentParagraph, 3, 'programmatic events retain the explicit jump bookmark');
  h.nav().commitScrollOffset(event(2400));
  h.settle();
  assert.equal(h.nav().settledParagraph, 3);
  h.renderer.unmount();
});

test('resize cancels the old frame check and settles the remounted page without saving progress', () => {
  const h = harness(2);
  h.layout(); h.content(); h.frame();
  h.layout(430, 900);
  assert.equal(h.nav().settledParagraph, null);
  h.settle();
  assert.equal(h.nav().settledParagraph, null);
  h.content(); h.settle();
  assert.equal(h.nav().settledParagraph, 2);
  assert.equal(h.nav().pageHeight, 900);
  assert.deepEqual(h.saved, []);
  h.renderer.unmount();
});

test('unmount cancels outstanding animation frames and background progress remains unchanged', () => {
  const h = harness(1);
  h.layout(); h.content();
  assert.equal(h.frames.size, 1);
  h.native.listeners.change('background');
  assert.deepEqual(h.saved, [1]);
  h.renderer.unmount();
  assert.equal(h.frames.size, 0);
  assert.equal(h.native.listeners.change, undefined);
});
