const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./loadSource.cjs');
const { createRenderer, nativeMock } = require('./helpers/render.cjs');
const { sample } = require('./helpers/app.cjs');

function harness() {
  const renderer = createRenderer(), native = nativeMock(), calibrations = [];
  native.useWindowDimensions = () => ({ width: 430, height: 932, fontScale: 1.3, scale: 3 });
  const tracking = { state: { enabled: false, busy: false }, capabilities: { available: true },
    sessionId: 'reader-test', calibrate: value => calibrations.push(value), disable() {}, acquireCamera() {} };
  const { summary, content } = sample();
  const { ReaderScreen } = loadSource('src/components/ReaderScreen.tsx', {
    react: renderer.react, 'react-native': native, expo: { requireOptionalNativeModule: () => null },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'src/hooks/useEyeTracking.ts': { useEyeTracking: () => tracking },
    'src/components/PageScanControl.tsx': { PageScanControl: 'Scan' },
  });
  renderer.mount(ReaderScreen, { book: summary, content, readingOffsets: [0, 10, 20, 30],
    preferences: { fontSize: 32, theme: 'night' }, onClose() {}, onProgressChange() {}, onPreferencesChange() {} });
  const label = text => renderer.nodes().find(node => node.props.accessibilityLabel === text);
  const viewport = renderer.nodes().find(node => node.props.onLayout);
  viewport.props.onLayout({ nativeEvent: { layout: { width: 430, height: 839 } } });
  let completeMeasurement;
  viewport.props.ref.current = { measureInWindow: callback => { completeMeasurement = callback; } };
  return { renderer, tracking, calibrations, label, viewport,
    measure: () => completeMeasurement(0, 59, 430, 839) };
}

test('reader calibration measures the viewport in window coordinates and forwards current scaling/theme', () => {
  const h = harness();
  h.label('Reading settings').props.onPress();
  h.label('Start eye tracking').props.onPress();
  assert.deepEqual(h.calibrations, [], 'camera setup waits for the actual viewport measurement');
  h.measure();
  assert.deepEqual(h.calibrations, [{ readerX: 0, readerY: 59, readerWidth: 430, readerHeight: 839,
    fontSize: 32, fontScale: 1.3, foreground: '#E7E8ED', background: '#101116' }]);
  assert.equal(h.label('Close reading settings'), undefined);
  h.renderer.unmount();
});

test('leaving the reader before viewport measurement returns never starts calibration', () => {
  const h = harness();
  h.label('Reading settings').props.onPress();
  h.label('Start eye tracking').props.onPress();
  h.viewport.props.ref.current = null;
  h.measure();
  assert.deepEqual(h.calibrations, []);
  h.renderer.unmount();
});

test('settings distinguish selected-camera capability from verified live depth evidence', () => {
  const h = harness();
  h.label('Reading settings').props.onPress();
  const strings = () => h.renderer.nodes().flatMap(node => node.props.children).filter(value => typeof value === 'string');
  assert.equal(strings().some(text => text.startsWith('TrueDepth verified')), false);
  h.tracking.state.cameraVerification = { state: 'checking', cameraType: 'AVCaptureDeviceTypeBuiltInTrueDepthCamera', depthFrameCount: 0 };
  assert.ok(strings().includes('Checking for live TrueDepth data…'));
  assert.equal(strings().some(text => text.startsWith('TrueDepth verified')), false);
  h.tracking.state.cameraVerification = { ...h.tracking.state.cameraVerification, state: 'verified', depthFrameCount: 3 };
  assert.ok(strings().includes('TrueDepth verified · Live depth data received during this session.'));
  h.renderer.unmount();
});
