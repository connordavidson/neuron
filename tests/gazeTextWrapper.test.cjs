const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./loadSource.cjs');
const { createRenderer } = require('./helpers/render.cjs');

test('native text wrapper ignores old layout and word events after a font-scale change', () => {
  const renderer = createRenderer(), words = [];
  let fontScale = 1;
  const { ReaderGazeText } = loadSource('modules/reader-eye-tracking/src/ReaderGazeText.tsx', {
    react: renderer.react,
    expo: { requireNativeView: () => 'NativeGazeText', requireOptionalNativeModule: () => ({}) },
    'react-native': { useWindowDimensions: () => ({ width: 390, fontScale }) },
  });
  const props = { text: 'The repeated repeated words.', fontSize: 24, textColor: '#000000',
    sessionId: 's', passageId: 'p', pageIndex: 0, pageHeight: 780, layoutRevision: 'layout', trackingActive: true,
    onPress() {}, onWordChange: event => words.push(event.nativeEvent) };
  const first = renderer.mount(ReaderGazeText, props);
  first.props.onTextLayout({ nativeEvent: { height: 100, layoutRevision: first.props.layoutRevision } });
  assert.equal(renderer.render().props.style.height, 100);
  fontScale = 1.5;
  const current = renderer.render();
  assert.equal(current.props.style.height, 1);
  first.props.onTextLayout({ nativeEvent: { height: 900, layoutRevision: first.props.layoutRevision } });
  first.props.onWordChange({ nativeEvent: { layoutRevision: first.props.layoutRevision } });
  assert.equal(renderer.render().props.style.height, 1);
  assert.deepEqual(words, []);
  current.props.onTextLayout({ nativeEvent: { height: 150, layoutRevision: current.props.layoutRevision } });
  current.props.onWordChange({ nativeEvent: { layoutRevision: current.props.layoutRevision } });
  assert.equal(renderer.render().props.style.height, 150);
  assert.equal(words.length, 1);
});
