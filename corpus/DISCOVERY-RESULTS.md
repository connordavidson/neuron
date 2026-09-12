# Corpus-driven parser: discovery iteration

## Scope and release status

This is an experimental parser revision on `feature/corpus-driven-parser`, not a passed release benchmark. The frozen local discovery manifest contains 50 original, born-digital OAPEN book PDFs, totalling 14,616 pages. All 50 were extracted and parsed, and the previous parser at `78d3ad7` was replayed on the same structured extractions for comparison. No catalogue title or section label is supplied to either parser; catalogue titles are consulted only by the audit afterwards.

The manifest has 16 non-empty publisher labels (one book has no publisher label), 710 distinct subject labels, and 47 PDFs with outlines. Page counts range from 8 to 1,041, with median 272; the page tiers contain 13 short, 23 medium and 14 long books. Rights are CC BY 4.0 for 49 books and CC BY 3.0 for one. Checksums, provenance, PDFs, extracted text, predictions and book-level diagnostics remain in ignored local files.

This is not a representative English-language release sample: 32 books have Springer publisher metadata, subjects overlap, some catalogue-English records contain multilingual material, and all 50 are discovery books used while developing the rules. The 300-book split, independently annotated development/locked-test sets, double review and 40 Standard Ebooks controls have **not** been completed. Promotion remains blocked.

## Measured comparison

These are unlabelled diagnostics on the same 50 books. Parser `78d3ad7` is the baseline; candidate `2fbad63` is revision 7. The frozen manifest SHA-256 is recorded in `benchmark-status.json`.

| Diagnostic | Before | After |
| --- | ---: | ---: |
| Exact normalized catalogue-title matches | 6 / 50 | 49 / 50 |
| Books without navigation entries | 1 | 0 |
| Empty reading flows | 0 | 0 |
| Words in the primary reading flow | 4,230,004 | 4,455,739 |
| Cards exceeding 250 words | 210 | 227 |
| Cards declaring other than one/two sentences | 0 | 0 |

The candidate produced 89,147 reading units. The remaining title mismatch involves a superscript decade suffix. Some individual books lost primary-flow words even though the aggregate increased; distinguishing newly excluded secondary material from lost prose requires annotation. Oversized cards increased, so this is not an across-the-board reliability pass.

Verification: 44 JavaScript tests, 8 Python tests and TypeScript checking passed. A real PDF also passed the new isolated extraction-worker path. The locked-test enforcement command correctly returned failure with missing metrics and `promotionAllowed: false` because no locked-test annotations exist.

## Rules now used for future imports

1. Reconstruct geometry before interpreting text. Separate columns that share an extractor line index; require repeated spatial support for narrow gutters so ordinary justified word gaps are not mistaken for columns. Read down each column between full-width dividers. Ignore off-page spans in the reading flow.
2. Join font runs using source offsets and physical gaps. An accent, italic syllable or font substitution inside a word must not introduce a space. Strip invisible extraction separators for matching, while retaining source anchors.
3. Estimate body typography across the document using character-weighted font frequency. A page full of small abstracts or footnotes must not redefine normal body text as headings.
4. Remove repeated edge furniture using text, style, page location and local repetition density. A chapter-specific running header need not appear throughout a quarter of the book. Protect long sentence-like text against this removal rule. Treat standalone numbers as page furniture only at page edges.
5. Build title candidates from aligned, similarly sized opening-page lines, not a single largest line. Reconcile cover and interior title-page repetition with plausible embedded metadata. Reject production filenames, series/editorial labels and bylines; use corroborated metadata to recover mixed-size title words. Catalogue data is not used at import time.
6. Confirm an outline destination against complete heading text, including wrapped headings, question titles, invisible characters and appended author bylines. Keep the publisher's outline hierarchy. Do not admit an unconfirmed generic outline merely because it exists.
7. Use restrictive semantic labels for references, index, copyright and notes. Ordinary prose mentioning these words must not open a section. A confirmed new chapter closes the preceding bibliography instead of inheriting its secondary-content classification.
8. Continue to reconstruct prose within detected sections before guarded sentence tokenization, generate two detected sentences per card (one for an unpaired final sentence), and preserve source anchors. Existing saved books are not automatically reflowed; the explicit Improve parsing flow still requires confident bookmark remapping.

The Python analysis extractor now resolves only relevant link fields, skips malformed annotations without discarding readable page text, releases page caches, and isolates each PDF in a process with a configurable timeout. Prediction workers also have timeouts and atomically replace completed JSON results.

## Reproducing the analysis

Use Python 3.12 with `requirements-corpus.txt`, Node dependencies, and Poppler for rendering. For the existing frozen local set:

```sh
python3 -m tools.corpus_cli sync
python3 -m tools.corpus_cli extract --workers 4 --timeout 1800
python3 -m tools.corpus_cli analyze --parse --workers 4
python3 -m tools.corpus_cli.audit --output corpus/reports/private/audit-after.json
npm run typecheck
npm test
python3 -m unittest discover -s tools/corpus_cli/tests
```

For one historical comparison, `node tools/run_parser.cjs INPUT.json OUTPUT.json --parser-ref 78d3ad7` loads that commit's parser and dependencies without changing the checkout. Store historical outputs in an ignored directory, then pass that directory to the audit with `--predictions`.

For a fresh 50-book discovery acquisition, use `python3 -m tools.corpus_cli sync --limit 50 --control-limit 0 --candidate-limit 100 --workers 4`. An existing manifest is verified rather than overwritten unless `--refresh` is explicitly supplied. Catalogues can change; only a frozen manifest reproduces the exact inputs.

## What remains unproven

Title agreement is a catalogue-string proxy, not held-out title accuracy. Reading/source word ratios include front matter, references, tables and extraction artefacts; they are not body-word retention. Counts of one/two-sentence cards only test the parser's own segmentation, not the correctness of linguistic sentence boundaries. Navigation availability is not chapter precision or recall.

The corpus uses Python/pdfplumber extraction and the deterministic JavaScript tokenizer fallback. The shared TypeScript parser is the one used by the app, but this run does not establish parity with PDFKit extraction or Apple's tokenizer on a physical iPhone. No new device build or physical-device import was tested in this iteration.

Remaining work includes independently labelled reading order and section boundaries; distinguishing table/glossary cells, captions and footnotes more reliably; preserving meaningful unconfirmed headings; superscript text in title reconstruction; exact transformed span-to-source mappings; and measuring native extraction/tokenization against the same PDFs. Oversized cards still need review and must not be split arbitrarily in violation of the two-sentence requirement.
