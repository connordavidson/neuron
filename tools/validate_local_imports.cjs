// Private-PDF regression check. Input files/extractions stay outside Git.
// Usage: node tools/validate_local_imports.cjs INPUT_MANIFEST OUTPUT_JSON
// The manifest contains { slug, path, pages, originalFileName } entries;
// PDFKit extraction JSON lives beside it at <slug>/extraction.json.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadSource } = require('../tests/loadSource.cjs');
const { parseEbook, CONTENT_PARSER_VERSION } = loadSource('src/lib/contentParser.ts');
const { CHAPTER_VERSION, detectBookStructure } = loadSource('src/lib/bookStructure.ts');
const {
  buildReadingOffsets, chapterProgressMarkers, readingProgressAtPosition,
  summaryAtPosition, ReadingSession,
} = loadSource('src/lib/readingPosition.ts');
const expectedCases = require('../tests/fixtures/local-imports.expected.json');

function matches(chapter, expected) {
  return chapter.kind === 'chapter'
    && chapter.pageIndex + 1 === expected.pdfPage
    && new RegExp(expected.titlePattern, 'iu').test(chapter.title);
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error('Usage: node tools/validate_local_imports.cjs INPUT_MANIFEST OUTPUT_JSON');
  const inputs = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const results = [];
  for (const expected of expectedCases) {
    const input = inputs.find(({ slug }) => slug === expected.slug);
    if (!input) throw new Error(`Missing input: ${expected.slug}`);
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(input.path)).digest('hex');
    if (checksum !== expected.sha256) throw new Error(`Different PDF edition: ${expected.slug}`);
    const extraction = JSON.parse(fs.readFileSync(path.join(path.dirname(inputPath), input.slug, 'extraction.json'), 'utf8'));
    if (extraction.pages.length !== expected.pdfPages) throw new Error(`Wrong extraction page count: ${input.slug}`);

    for (const mode of ['structured', 'text-only']) {
      const parsed = await parseEbook(mode === 'structured' ? extraction : { ...extraction, structuredPages: [] }, input.originalFileName);
      const offsets = buildReadingOffsets(parsed);
      const markers = chapterProgressMarkers(parsed, offsets);
      const invariants = [];
      if (!parsed.paragraphs.length) invariants.push('No readable content');
      if (markers.some((fraction, index) => !Number.isFinite(fraction) || fraction < 0 || fraction > 1
        || index > 0 && fraction <= markers[index - 1])) invariants.push('Invalid or unordered chapter markers');
      if (parsed.readingUnits.some(({ sentenceCount }) => sentenceCount > 2)) invariants.push('More than two sentences in a reading unit');
      if (parsed.chapters.some(({ paragraphIndex, pageIndex }) => !Number.isInteger(paragraphIndex)
        || paragraphIndex < 0 || paragraphIndex >= parsed.paragraphs.length
        || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= expected.pdfPages)) {
        invariants.push('Navigation outside PDF/reading bounds');
      }
      let previous = 0;
      for (let i = 0; i < parsed.paragraphs.length; i++) {
        const progress = readingProgressAtPosition(parsed, offsets, i);
        if (!Number.isFinite(progress) || progress < previous || progress < 0 || progress > 1) {
          invariants.push('Invalid or decreasing progress');
          break;
        }
        previous = progress;
      }
      for (const fraction of [0.1, 0.5, 0.9]) {
        const index = Math.floor((parsed.paragraphs.length - 1) * fraction);
        const summary = summaryAtPosition({ id: 'local-audit', currentParagraph: index }, parsed, offsets, index);
        const restored = new ReadingSession(summary.currentParagraph, parsed.paragraphs.length);
        restored.scroll(0, 780);
        if (restored.index !== index || summary.readingProgress !== readingProgressAtPosition(parsed, offsets, index)) {
          invariants.push('Reading-session/summary resume mismatch');
        }
      }

      const missingChapters = expected.chapters.filter((chapter) => !parsed.chapters.some((actual) => matches(actual, chapter)));
      const forbiddenNavigation = parsed.chapters.filter((chapter) => expected.forbiddenNavigation.some((rule) =>
        new RegExp(rule.titlePattern, 'iu').test(chapter.title)
        && chapter.pageIndex + 1 >= rule.firstPDFPage && chapter.pageIndex + 1 <= rule.lastPDFPage));
      const readingStartPDF = parsed.paragraphPages[parsed.readingStart] + 1;
      // Diagnostic comparison only: fresh imports do not invoke this repair.
      const repair = detectBookStructure(parsed.paragraphs, {
        sourcePages: extraction.pages, outlines: extraction.outlines, paragraphPages: parsed.paragraphPages,
      });
      const result = {
        slug: input.slug, mode, sourceSHA256: checksum, parserVersion: CONTENT_PARSER_VERSION,
        chapterVersion: CHAPTER_VERSION, readingUnits: parsed.paragraphs.length,
        navigationEntries: parsed.chapters.length, railMarkersIncludingEndpoints: markers.length, markerFractions: markers,
        readingStartPDF, expectedReadingStartPDF: expected.readingStartPDF,
        checkedChapters: expected.chapters.length, matchedChapters: expected.chapters.length - missingChapters.length,
        missingChapters, forbiddenNavigation: forbiddenNavigation.map(({ title, pageIndex }) => ({ title, pdfPage: pageIndex + 1 })),
        navigationOnlyRepairMatchedChapters: expected.chapters.filter((chapter) => repair.chapters.some((actual) => matches(actual, chapter))).length,
        invariantFailures: invariants,
        passed: invariants.length === 0 && missingChapters.length === 0 && forbiddenNavigation.length === 0
          && readingStartPDF === expected.readingStartPDF,
      };
      results.push(result);
      console.log(`${result.passed ? 'PASS' : 'FAIL'} ${input.slug} (${mode}): ${result.matchedChapters}/${result.checkedChapters} checked chapters; ${forbiddenNavigation.length} forbidden entries; start PDF ${readingStartPDF} (expected ${expected.readingStartPDF}); ${invariants.length} invariant failures`);
    }
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({
    checkedAt: new Date().toISOString(),
    method: 'macOS PDFKit extraction + production JS parser with fallback sentence splitting; not an iOS Files-picker or native-tokenizer test',
    results,
  }, null, 2) + '\n');
  if (results.some(({ passed }) => !passed)) process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
