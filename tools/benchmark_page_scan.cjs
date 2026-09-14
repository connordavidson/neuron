// Deterministic, synthetic long-book benchmark; no private book text is used.
// Node measures a desktop baseline, not physical iPhone performance.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { loadSource } = require('../tests/loadSource.cjs');
const { matchScannedPageAsync } = loadSource('src/lib/pageScanMatcher.ts');

const vocabulary = 'river garden forest mountain valley bridge village window morning evening winter summer autumn spring silver golden green blue violet crimson gentle narrow ancient distant quiet bright weather water stone wooden basket garden orchard meadow fields harvest flowers branches roots leaves birds robin sparrow swallow hawk eagle deer fox wolf rabbit horse cat dog cabin house tower mill path road trail stream pond lake sea coast cliff sand rain wind cloud thunder snow frost mist dawn dusk light shadow story chapter letter paper pen ink painting music song voice bell clock wheel boat sail shore harbor ship captain traveler teacher student carpenter sailor farmer child friend stranger family mother father sister brother uncle aunt bread apple pear plum cherry peach grape lemon orange seed grain rice wheat honey salt pepper'.split(' ');
let seed = 741;
const tokens = Array.from({ length: 300000 }, () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return vocabulary[seed % vocabulary.length];
});
const paragraphs = [];
for (let i = 0; i < tokens.length; i += 48) paragraphs.push(tokens.slice(i, i + 48).join(' '));
const start = 219847;
const scan = 'WALKING THROUGH THE VALLEY\n' + tokens.slice(start, start + 260)
  .map((word, i) => i % 17 === 16 ? 'unreadable' : word).join(' ') + '\n241';

(async () => {
  let previousTick = performance.now();
  let maximumTickGapMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maximumTickGapMs = Math.max(maximumTickGapMs, now - previousTick);
    previousTick = now;
  }, 10);
  const started = performance.now();
  try {
    const result = await matchScannedPageAsync(paragraphs, scan);
    assert.equal(result.status, 'matched');
    assert.equal(result.paragraphIndex, Math.floor(start / 48));
    console.log(JSON.stringify({ runtime: `Node ${process.version} on ${process.platform}/${process.arch}`,
      bookWords: tokens.length, scannedWords: 260,
      elapsedMs: Math.round(performance.now() - started),
      maximumTickGapMs: Math.round(maximumTickGapMs), result }, null, 2));
  } finally { clearInterval(timer); }
})().catch(error => { console.error(error); process.exitCode = 1; });
