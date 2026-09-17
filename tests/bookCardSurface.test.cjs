const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadSource } = require('./loadSource.cjs');

function renderCard() {
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: value => [value, () => {}], useRef: value => ({ current: value }),
    useMemo: fn => fn(), useEffect() {},
  };
  class Value {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    stopAnimation() {}
  }
  const native = {
    ...Object.fromEntries(['View', 'Text', 'Pressable', 'FlatList', 'SafeAreaView', 'TextInput'].map(name => [name, name])),
    StyleSheet: { create: styles => styles },
    Animated: { Value, View: 'AnimatedView', spring: (value, options) => ({ start: () => value.setValue(options.toValue) }) },
    PanResponder: { create: handlers => ({ panHandlers: handlers }) },
  };
  const { LibraryScreen } = loadSource('src/components/LibraryScreen.tsx', {
    react, 'react-native': native, 'expo-status-bar': { StatusBar: 'StatusBar' },
  });
  const book = { id: 'book', title: 'Test book', originalFileName: 'book.pdf', paragraphCount: 10, currentParagraph: 0 };
  const opened = [], deleted = [];
  const screen = LibraryScreen({ books: [book], isLoading: false, isImporting: false, openingBookID: null,
    onImport() {}, onOpenBook: value => opened.push(value), onDeleteBook: value => deleted.push(value) });
  const list = nodes(screen).find(node => node.type === 'FlatList');
  const element = list.props.renderItem({ item: book });
  return { tree: element.type(element.props), opened, deleted };
}

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}
function styleOf(node, pressed) {
  const style = typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style;
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

// Check the visible layers at the vertical midpoint of a 400-point row. Layout
// and antialiasing still need native inspection; this catches the scaled-card
// gap that exposes the delete layer, using actual rendered production styles.
function backgroundAt(tree, x, pressed) {
  const all = nodes(tree);
  const action = all.find(node => node.props.accessibilityLabel === 'Delete Test book');
  const moving = all.find(node => node.type === 'AnimatedView');
  const card = nodes(moving).find(node => node.type === 'Pressable');
  const movingStyle = styleOf(moving, pressed);
  const cardStyle = styleOf(card, pressed);
  const translate = movingStyle.transform.find(value => 'translateX' in value).translateX.value;
  const scale = cardStyle.transform?.find(value => 'scale' in value)?.scale ?? 1;
  let color = styleOf(action, pressed).backgroundColor;
  if (x >= translate && x <= 400 + translate && movingStyle.backgroundColor) color = movingStyle.backgroundColor;
  if (x >= translate + 200 * (1 - scale) && x <= translate + 200 * (1 + scale)) color = cardStyle.backgroundColor;
  return color;
}

test('pressing a closed book keeps the Delete color covered at the card edge', () => {
  const { tree, opened, deleted } = renderCard();
  const row = nodes(tree).find(node => node.props.accessibilityHint);
  row.props.onPressIn();
  for (const pressed of [false, true]) {
    assert.notEqual(backgroundAt(tree, 399.5, pressed), '#C93434', 'the right edge must not reveal Delete during a tap');
  }
  row.props.onPress();
  assert.equal(opened.length, 1);
  assert.equal(deleted.length, 0);
});

test('a deliberate swipe still reveals Delete and does not open the book', () => {
  const { tree, opened, deleted } = renderCard();
  const row = nodes(tree).find(node => node.props.accessibilityHint);
  const moving = nodes(tree).find(node => node.type === 'AnimatedView');
  row.props.onPressIn();
  const gesture = { dx: -90, dy: 2, vx: -0.3 };
  assert.equal(moving.props.onMoveShouldSetPanResponder(null, gesture), true);
  moving.props.onPanResponderGrant();
  moving.props.onPanResponderMove(null, gesture);
  moving.props.onPanResponderRelease(null, gesture);
  assert.equal(backgroundAt(tree, 399.5, false), '#C93434');
  row.props.onPress();
  assert.equal(opened.length, 0);
  assert.equal(deleted.length, 0);
});
