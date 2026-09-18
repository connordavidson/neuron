const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

test('native camera proof rejects stale or invalid data, requires distinct live depth, and resets each run', { skip: process.platform !== 'darwin' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-gaze-camera-'));
  try {
    const source = fs.readFileSync(path.join(__dirname, '../modules/reader-eye-tracking/ios/GazeCameraVerification.swift'), 'utf8');
    const cases = fs.readFileSync(path.join(__dirname, 'helpers/gaze-camera-verification-cases.swift'), 'utf8');
    const file = path.join(directory, 'main.swift');
    fs.writeFileSync(file, source + '\n' + cases);
    const output = execFileSync('swift', [file], {
      encoding: 'utf8', env: { ...process.env, CLANG_MODULE_CACHE_PATH: path.join(directory, 'cache') }, timeout: 120000,
    });
    assert.match(output, /Gaze camera verification cases passed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
