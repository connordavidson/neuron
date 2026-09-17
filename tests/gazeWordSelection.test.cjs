const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

test('native gaze: production word selector handles skips, regressions, noise, wrapping and Unicode', { skip: process.platform !== 'darwin' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-gaze-words-'));
  try {
    const source = fs.readFileSync(path.join(__dirname, '../modules/reader-eye-tracking/ios/GazeWordSelector.swift'), 'utf8');
    const cases = fs.readFileSync(path.join(__dirname, 'helpers/gaze-word-cases.swift'), 'utf8');
    const file = path.join(directory, 'main.swift');
    fs.writeFileSync(file, source + '\n' + cases);
    const output = execFileSync('swift', [file], {
      encoding: 'utf8', env: { ...process.env, CLANG_MODULE_CACHE_PATH: path.join(directory, 'cache') }, timeout: 120000,
    });
    assert.match(output, /Gaze word selection cases passed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
