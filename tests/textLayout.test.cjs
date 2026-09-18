const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./loadSource.cjs');
const { createRenderer, nativeMock } = require('./helpers/render.cjs');
const { sample } = require('./helpers/app.cjs');
const { readerTextMinHeight } = loadSource('src/lib/textLayout.ts');

// Yoga's float32 absolute-coordinate subtraction, including the native pixel
// grid. Native simulator coverage is recorded in design/text-wrap-validation.md.
function roundedHeight(top, height, scale) {
  const round = value => Math.fround(Math.round(value * scale) / scale);
  return round(top + height) - round(top);
}

test('text height allowance survives rounding at deep reading positions', () => {
  let unprotectedFailures = 0;
  for (const scale of [2, 3]) {
    for (const index of [0, 1000, 2000, 3740, 6000, 10000, 25000, 100000]) {
      for (const naturalHeight of [29.7, 267.3, 285.768, 599.999, 1800.2]) {
        for (const inset of [70, 212.5, 212.6667, 400]) {
          const top = index * 839 + inset;
          const firstHeight = roundedHeight(top, Math.ceil(naturalHeight * scale) / scale, scale);
          if (firstHeight < naturalHeight) unprotectedFailures++;
          const guardedHeight = readerTextMinHeight(firstHeight, (index + 1) * 839);
          assert.ok(roundedHeight(top, guardedHeight, scale) >= naturalHeight,
            `index=${index}, height=${naturalHeight}, inset=${inset}, scale=${scale}`);
        }
      }
    }
  }
  assert.ok(unprotectedFailures > 0, 'the fixture must exercise the original clipping bug');
});

function paragraphHarness() {
  const r = createRenderer();
  const native = nativeMock();
  let fontScale = 1;
  native.useWindowDimensions = () => ({ width: 430, height: 932, scale: 3, fontScale });
  const { summary, content } = sample();
  const { ReaderScreen } = loadSource('src/components/ReaderScreen.tsx', {
    react: r.react, 'react-native': native, 'expo-status-bar': { StatusBar: 'StatusBar' },
    'src/components/PageScanControl.tsx': { PageScanControl: 'Scan' },
  });
  r.mount(ReaderScreen, {
    book: summary, content, readingOffsets: [0, 10, 20, 30],
    preferences: { fontSize: 22, theme: 'paper' },
    onClose() {}, onProgressChange() {}, onPreferencesChange() {},
  });
  r.nodes().find(n => n.props.onLayout).props.onLayout({ nativeEvent: { layout: { width: 430, height: 839 } } });
  const element = r.nodes().find(n => n.type === 'FlatList').props.renderItem({ item: 'The final word must remain visible.', index: 6000 });
  let props = element.props;
  r.mount(element.type, props);
  const text = () => r.nodes().find(n => n.type === 'Text' && n.props.selectable);
  const minHeight = () => Object.assign({}, ...text().props.style).minHeight;
  const layout = (height, width = 370) => text().props.onLayout({ nativeEvent: { layout: { width, height } } });
  return { r, text, minHeight, layout, scale(value) { fontScale = value; r.render(); },
    update(next) { props = { ...props, ...next }; r.update(props); } };
}

test('reader reserves drawing height once, without a layout feedback loop', () => {
  const h = paragraphHarness();
  assert.equal(h.minHeight(), undefined);
  h.layout(0, 0);
  assert.equal(h.minHeight(), undefined);
  h.layout(267);
  const height = h.minHeight();
  assert.ok(height > 267.3);
  h.layout(height);
  h.layout(height + 1);
  assert.equal(h.minHeight(), height);
  assert.equal(h.text().props.children.join(''), 'The final word must remain visible.');
  assert.equal(Object.assign({}, ...h.text().props.style).fontSize, 22);
});

test('reader remeasures after text, width, font size, or accessibility scaling changes', () => {
  const h = paragraphHarness();
  h.layout(267);
  const staleLayout = h.text().props.onLayout;
  h.update({ fontSize: 24 });
  assert.equal(h.minHeight(), undefined);
  staleLayout({ nativeEvent: { layout: { width: 370, height: 1000 } } });
  assert.equal(h.minHeight(), undefined);
  h.layout(330);
  assert.ok(h.minHeight() >= 332);
  for (const change of [{ text: 'A shorter sentence.' }, { width: 700 }, { height: 700 }, { pageIndex: 10000 }]) {
    h.update(change);
    assert.equal(h.minHeight(), undefined);
    h.layout(36);
    assert.ok(h.minHeight() > 36);
  }
  h.scale(1.5);
  assert.equal(h.minHeight(), undefined);
  h.layout(54);
  assert.ok(h.minHeight() > 54);
});
