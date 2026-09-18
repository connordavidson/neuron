const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { transformSync } = require('@babel/core');
const { loadSource } = require('./loadSource.cjs');

// Render production chapter rows, then exercise React Native's installed
// Pressability state machine with a controlled clock. Native scroll recognition
// is represented by responder termination; this is not a native gesture test.
function chapterRow(initialPanel = 'Open chapters') {
  const slots = [];
  let cursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ||= { current: initial };
    },
    useMemo: fn => fn(),
    useCallback: fn => fn,
    useEffect() {},
  };
  const native = {
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 }),
    ...Object.fromEntries(['View', 'Text', 'Pressable', 'SafeAreaView', 'ScrollView', 'FlatList'].map(name => [name, name])),
    StyleSheet: { create: styles => styles, absoluteFill: {}, hairlineWidth: 1 },
    Animated: { Value: class {}, View: 'AnimatedView', timing: () => ({ start() {} }) },
  };
  const { ReaderScreen } = loadSource('src/components/ReaderScreen.tsx', {
    expo: { requireOptionalNativeModule: () => null }, react, 'react-native': native, 'expo-status-bar': { StatusBar: 'StatusBar' },
    './ReaderProgress': { ReaderProgress: 'ReaderProgress' },
    './PageScanControl': { PageScanControl: 'PageScanControl' },
  });
  const progress = [], closed = [], preferences = [];
  const props = {
    book: { id: 'chapters', title: 'Chapter gestures', currentParagraph: 0 },
    content: {
      paragraphs: ['First page.', 'Second page.'], readingStart: 0,
      chapters: [{ title: 'Second chapter', paragraphIndex: 1, kind: 'chapter' }],
    },
    readingOffsets: [0, 2, 4], preferences: { fontSize: 24, theme: 'paper' },
    onProgressChange: index => progress.push(index), onClose: index => closed.push(index),
    onPreferencesChange: value => preferences.push(value),
  };
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== 'object') return [];
    if (typeof node.type === 'function' && /Panel$/.test(node.type.name)) return nodes(node.type(node.props));
    return [node, ...nodes(node.props?.children)];
  }
  const render = () => { cursor = 0; return nodes(ReaderScreen(props)); };
  render().find(node => node.props.accessibilityLabel === initialPanel).props.onPress();
  const row = render().find(node => node.props.accessibilityLabel === 'Jump to Second chapter');
  if (initialPanel === 'Open chapters') assert.ok(row, 'exercise the production chapter row');
  return { props: row?.props, progress, closed, preferences, render,
    panelOpen: () => render().some(node => node.props.accessibilityLabel === 'Close chapters') };
}

function pressability(row, t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const filename = require.resolve('react-native/Libraries/Pressability/Pressability');
  const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false,
    plugins: ['babel-plugin-syntax-hermes-parser', '@babel/plugin-transform-flow-strip-types', '@babel/plugin-transform-modules-commonjs'],
  });
  const mocks = {
    '../../src/private/featureflags/ReactNativeFeatureFlags': { shouldPressibilityUseW3CPointerEventsForHover: () => false },
    '../Components/Sound/SoundManager': { playTouchSound() {} },
    '../ReactNative/UIManager': { measure: (_id, callback) => callback(0, 0, 320, 80, 0, 0) },
    '../StyleSheet/Rect': { normalizeRect: value => value },
    '../Utilities/Platform': { OS: 'ios' },
    './HoverState': { isHoverEnabled: () => false },
    './PressabilityPerformanceEventEmitter.js': { emitEvent() {} },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : require(name), module, module.exports);
  let pressed = false;
  const appearance = () => {
    const style = typeof row.props.style === 'function' ? row.props.style({ pressed }) : row.props.style;
    return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
  };
  const instance = new module.exports.default({
    // These are the public row props forwarded by RN Pressable to Pressability.
    delayPressIn: row.props.unstable_pressDelay, cancelable: row.props.cancelable,
    onPress: row.props.onPress,
    onPressIn: () => { pressed = true; }, onPressOut: () => { pressed = false; },
  });
  t.after(() => instance.reset());
  const event = { currentTarget: 1, target: 1, nativeEvent: { pageX: 40, pageY: 40 }, persist() {} };
  return { handlers: instance.getEventHandlers(), event, appearance };
}

test('chapter scroll startup does not flash a row or navigate', t => {
  const row = chapterRow();
  const { handlers, event, appearance } = pressability(row, t);
  const restingAppearance = appearance();
  handlers.onResponderGrant(event);
  t.mock.timers.tick(75);
  assert.deepEqual(appearance(), restingAppearance, 'do not highlight while a scroll gesture is starting');
  assert.equal(handlers.onResponderTerminationRequest(), true);
  handlers.onResponderTerminate(event);
  t.mock.timers.tick(1000);
  assert.deepEqual(appearance(), restingAppearance, 'a cancelled scroll must not flash later');
  assert.deepEqual(row.progress, []);
  assert.equal(row.panelOpen(), true);
});

test('a quick chapter tap navigates immediately on release', t => {
  const row = chapterRow();
  const { handlers, event } = pressability(row, t);
  handlers.onResponderGrant(event);
  assert.deepEqual(row.progress, [], 'touch-down must not navigate');
  t.mock.timers.tick(40);
  handlers.onResponderRelease(event);
  assert.deepEqual(row.progress, [1]);
  assert.equal(row.panelOpen(), false);
  t.mock.timers.tick(1000);
  assert.deepEqual(row.progress, [1], 'one tap must produce one chapter jump');
});

test('holding a chapter row preserves its appearance and can yield to scrolling', t => {
  const row = chapterRow();
  const { handlers, event, appearance } = pressability(row, t);
  const restingAppearance = appearance();
  handlers.onResponderGrant(event);
  t.mock.timers.tick(200);
  assert.deepEqual(appearance(), restingAppearance, 'holding must not shrink, fade, or recolor a chapter');
  assert.equal(handlers.onResponderTerminationRequest(), true);
  handlers.onResponderTerminate(event);
  t.mock.timers.tick(1000);
  assert.deepEqual(appearance(), restingAppearance);
  assert.deepEqual(row.progress, []);
  assert.equal(row.panelOpen(), true);
});

test('accessibility activation still jumps to the chapter', t => {
  const row = chapterRow();
  const { handlers, event } = pressability(row, t);
  handlers.onClick(event);
  assert.deepEqual(row.progress, [1]);
  assert.equal(row.panelOpen(), false);
});

for (const [openLabel, closeLabel] of [['Open chapters', 'Close chapters'], ['Reading settings', 'Close reading settings']]) {
  test(`outside tap dismisses ${openLabel} without changing the reader`, () => {
    const reader = chapterRow(openLabel);
    const nodes = reader.render();
    const backdrop = nodes.find(node => node.props.accessibilityLabel === 'Dismiss reader panel');
    assert.ok(backdrop, 'an open panel must intercept outside taps');
    assert.ok(nodes.indexOf(backdrop) > nodes.findIndex(node => node.props.accessibilityLabel === 'Back to library'));
    assert.ok(nodes.indexOf(backdrop) < nodes.findIndex(node => node.props.accessibilityLabel === closeLabel), 'panel controls remain above the dismiss surface');
    backdrop.props.onPress();
    const next = reader.render();
    assert.ok(!next.some(node => node.props.accessibilityLabel === closeLabel));
    assert.ok(!next.some(node => node.props.accessibilityLabel === 'Dismiss reader panel'));
    assert.deepEqual(reader.progress, []);
    assert.deepEqual(reader.closed, []);
    assert.deepEqual(reader.preferences, []);
    assert.equal(next.find(node => node.type === 'PageScanControl').props.visible, true, 'reader controls stay visible after dismissal');
  });
}

test('font controls inside the settings panel remain interactive without dismissing it', () => {
  const reader = chapterRow('Reading settings');
  reader.render().find(node => node.props.accessibilityLabel === 'Increase text size').props.onPress();
  assert.deepEqual(reader.preferences, [{ fontSize: 26, theme: 'paper' }]);
  assert.ok(reader.render().some(node => node.props.accessibilityLabel === 'Close reading settings'));
  assert.deepEqual(reader.closed, []);
  assert.deepEqual(reader.progress, []);
});
