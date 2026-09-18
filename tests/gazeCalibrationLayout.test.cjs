const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

test('native calibration: five reader-aligned rows, independent checks, scaling and invalid viewports', { skip: process.platform !== 'darwin' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-gaze-calibration-layout-'));
  try {
    const native = path.join(__dirname, '../modules/reader-eye-tracking/ios');
    const source = ['GazeMath.swift', 'GazeCalibrationLayout.swift'].map(name => fs.readFileSync(path.join(native, name), 'utf8')).join('\n');
    const cases = fs.readFileSync(path.join(__dirname, 'helpers/gaze-calibration-layout-cases.swift'), 'utf8');
    const file = path.join(directory, 'main.swift');
    fs.writeFileSync(file, source + '\n' + cases);
    const output = execFileSync('swift', [file], {
      encoding: 'utf8', env: { ...process.env, CLANG_MODULE_CACHE_PATH: path.join(directory, 'cache') }, timeout: 120000,
    });
    assert.match(output, /Gaze calibration layout cases passed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
