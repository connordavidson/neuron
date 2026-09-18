const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./loadSource.cjs');
const { deferred, settle } = require('./helpers/render.cjs');
const { EyeTrackingSession } = loadSource('src/lib/eyeTrackingSession.ts');
const layout = { readerX: 0, readerY: 59, readerWidth: 430, readerHeight: 839, fontSize: 24, fontScale: 1, foreground: '#1F1D19', background: '#F8F6F0' };

function harness(overrides = {}) {
  const calls = [], states = [];
  let listener;
  const native = {
    getCapabilities: () => ({ available: true }),
    start: async id => { calls.push(['start', id]); },
    pause: async id => { calls.push(['pause', id]); },
    stop: async id => { calls.push(['stop', id]); },
    calibrate: async (id, options) => { calls.push(['calibrate', id, options]); },
    addListener: (_, callback) => { listener = callback; return { remove: () => { listener = undefined; } }; },
    ...overrides,
  };
  const session = new EyeTrackingSession(native, state => states.push(state));
  session.connect();
  return { session, native, calls, states, emit: status => listener?.({ sessionId: session.id, quality: 'good', ...status }) };
}

test('gaze: off by default; an explicit start calibrates; no native module remains usable', async () => {
  const h = harness();
  assert.equal(h.session.state.enabled, false);
  assert.deepEqual(h.calls, []);
  await h.session.calibrate(layout);
  assert.deepEqual(h.calls.map(c => c[0]), ['start', 'calibrate']);
  assert.equal(h.session.state.calibrated, true);
  const missing = new EyeTrackingSession(null, () => {});
  await missing.calibrate(layout);
  assert.equal(missing.capabilities.available, false);
  assert.equal(missing.state.enabled, false);
  h.session.dispose();
});

test('gaze: a scanner lease waits for native pause and prevents all restarts until release', async () => {
  const pause = deferred();
  const h = harness({ pause: () => pause.promise });
  await h.session.calibrate(layout);
  let acquired = false;
  const pending = h.session.acquireCamera().then(release => { acquired = true; return release; });
  await settle();
  assert.equal(acquired, false);
  h.session.setBlocked('panel', true);
  h.session.setBlocked('panel', false);
  pause.resolve();
  const release = await pending;
  await settle();
  assert.equal(h.calls.filter(c => c[0] === 'start').length, 1);
  release(); release();
  await settle();
  assert.equal(h.calls.filter(c => c[0] === 'start').length, 2, 'idempotent release resumes once');
  h.session.dispose();
});

test('gaze: overlapping leases and background state both block restart', async () => {
  const h = harness();
  await h.session.calibrate(layout);
  const releaseA = await h.session.acquireCamera();
  const releaseB = await h.session.acquireCamera();
  releaseA();
  h.session.setBlocked('background', true);
  releaseB();
  await settle();
  assert.equal(h.calls.filter(c => c[0] === 'start').length, 1);
  h.session.setBlocked('background', false);
  await settle();
  assert.equal(h.calls.filter(c => c[0] === 'start').length, 2);
  h.session.dispose();
});

test('gaze: disable during a pending permission/start never opens calibration', async () => {
  const start = deferred();
  const h = harness({ start: () => start.promise });
  const pending = h.session.calibrate(layout);
  await settle();
  h.session.disable();
  start.resolve();
  await pending; await settle();
  assert.equal(h.calls.some(c => c[0] === 'calibrate'), false);
  assert.equal(h.calls.at(-1)[0], 'stop');
  assert.equal(h.session.state.enabled, false);
  h.session.dispose();
});

test('gaze: long calibration does not block camera suspension or disposal', async () => {
  const calibration = deferred();
  const h = harness({ calibrate: () => calibration.promise });
  const pending = h.session.calibrate(layout);
  await settle();
  const release = await h.session.acquireCamera();
  assert.equal(h.calls.at(-1)[0], 'pause');
  h.session.dispose();
  release();
  calibration.resolve();
  await pending; await settle();
  assert.equal(h.calls.at(-1)[0], 'stop');
  assert.equal(h.calls.filter(c => c[0] === 'start').length, 1);
  assert.equal(h.session.state.calibrated, false);
});

test('gaze: stale sessions and queued tracking events cannot override suspension or disable', async () => {
  const h = harness();
  await h.session.calibrate(layout);
  h.emit({ sessionId: 'obsolete-reader', phase: 'error' });
  assert.notEqual(h.session.state.phase, 'error');
  h.session.setBlocked('scanner', true);
  h.emit({ phase: 'paused', quality: 'unavailable' });
  h.emit({ phase: 'tracking' });
  assert.equal(h.session.state.phase, 'paused');
  h.session.disable();
  h.emit({ phase: 'tracking' });
  assert.equal(h.session.state.phase, 'idle');
  h.session.dispose();
});

test('gaze: permission errors and cancelled calibration provide recovery without saving progress', async () => {
  const denied = harness();
  denied.native.start = async () => {
    denied.emit({ phase: 'error', reason: 'permission', quality: 'unavailable' });
    throw { code: 'ERR_GAZE_PERMISSION' };
  };
  await denied.session.calibrate(layout);
  assert.equal(denied.session.state.reason, 'ERR_GAZE_PERMISSION');
  assert.equal(denied.session.state.busy, false);
  assert.equal(denied.session.state.calibrated, false);
  denied.session.setBlocked('panel', true);
  denied.emit({ phase: 'paused', quality: 'unavailable', reason: 'paused' });
  assert.equal(denied.session.state.reason, 'ERR_GAZE_PERMISSION', 'panel suspension preserves Open Settings recovery');
  denied.session.dispose();
  const cancelled = harness({ calibrate: async () => { throw { code: 'ERR_GAZE_CANCELLED' }; } });
  await cancelled.session.calibrate(layout);
  assert.equal(cancelled.session.state.phase, 'paused');
  assert.equal(cancelled.session.state.busy, false);
  const starts = cancelled.calls.filter(c => c[0] === 'start').length;
  cancelled.session.setBlocked('panel', true);
  cancelled.session.setBlocked('panel', false);
  cancelled.session.setApplicationState('active');
  const release = await cancelled.session.acquireCamera();
  release();
  await settle();
  assert.equal(cancelled.calls.filter(c => c[0] === 'start').length, starts, 'no uncalibrated camera restart');
  cancelled.session.dispose();
});

test('gaze: first permission inactivity does not drop calibration and active always reconciles', async () => {
  const permission = deferred();
  const h = harness({ start: () => permission.promise });
  const pending = h.session.calibrate(layout);
  await settle();
  h.session.setApplicationState('inactive');
  permission.resolve();
  await pending;
  assert.equal(h.calls.filter(c => c[0] === 'calibrate').length, 1);
  assert.equal(h.session.state.calibrated, true);
  h.session.setApplicationState('active');
  await settle();
  h.session.dispose();
});

test('gaze: disable immediately reaches native before pending permission resolves', async () => {
  const permission = deferred();
  let cancelled = false, captured = false;
  const h = harness({
    start: async () => { await permission.promise; if (!cancelled) captured = true; },
    stop: async () => { cancelled = true; },
  });
  const pending = h.session.calibrate(layout);
  await settle();
  h.session.disable();
  assert.equal(cancelled, true, 'stop is not serialized behind the permission promise');
  permission.resolve();
  await pending;
  assert.equal(captured, false);
  h.session.dispose();
});

test('gaze: recalibration discards prior calibrated eligibility even when cancelled', async () => {
  const h = harness();
  await h.session.calibrate(layout);
  h.native.calibrate = async () => { throw { code: 'ERR_GAZE_CANCELLED' }; };
  await h.session.calibrate(layout);
  assert.equal(h.session.state.calibrated, false);
  h.session.dispose();
});

test('gaze: an ended interruption resumes only when calibrated and camera is unclaimed', async () => {
  const h = harness();
  await h.session.calibrate(layout);
  h.emit({ phase: 'paused', quality: 'unavailable', reason: 'interruptionEnded' });
  await settle();
  assert.equal(h.calls.filter(c => c[0] === 'start').length, 2);
  const release = await h.session.acquireCamera();
  h.emit({ phase: 'paused', quality: 'unavailable', reason: 'interruptionEnded' });
  await settle();
  assert.equal(h.calls.filter(c => c[0] === 'start').length, 2, 'scanner still owns camera');
  h.session.disable();
  release();
  await settle();
  assert.equal(h.calls.filter(c => c[0] === 'start').length, 2);
  h.session.dispose();
});


test('gaze: calibration receives the actual reader bounds and typography', async () => {
  const h = harness();
  const scaled = { ...layout, readerY: 72, readerHeight: 720, fontSize: 32, fontScale: 1.3 };
  await h.session.calibrate(scaled);
  assert.deepEqual(h.calls.find(call => call[0] === 'calibrate'), ['calibrate', h.session.id, scaled]);
  h.session.dispose();
});

test('gaze: live camera proof is session-scoped and clears on disable and new setup', async () => {
  const h = harness();
  await h.session.calibrate(layout);
  const proof = { state: 'verified', cameraType: 'AVCaptureDeviceTypeBuiltInTrueDepthCamera', depthFrameCount: 3, depthWidth: 640, depthHeight: 480 };
  h.emit({ phase: 'tracking', cameraVerification: proof });
  assert.deepEqual(h.session.state.cameraVerification, proof);
  h.session.setBlocked('panel', true);
  h.emit({ phase: 'paused', cameraVerification: proof });
  assert.deepEqual(h.session.state.cameraVerification, proof, 'settings can show proof after pausing capture');
  h.emit({ sessionId: 'old-reader', phase: 'paused', cameraVerification: { state: 'unavailable' } });
  assert.deepEqual(h.session.state.cameraVerification, proof);
  h.session.disable();
  assert.equal(h.session.state.cameraVerification, undefined);
  h.session.setBlocked('panel', false);
  await h.session.calibrate(layout);
  assert.equal(h.session.state.cameraVerification, undefined, 'old proof must not verify a new run');
  h.session.dispose();
});
