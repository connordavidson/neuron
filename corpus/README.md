# Private parser benchmark

The benchmark CLI downloads only English, born-digital works whose exact rights URI is Public Domain Mark, CC0, CC BY 3.0, or CC BY 4.0. Unknown licenses and licenses containing NC, ND, or SA are rejected before download.

Run `python3 -m tools.corpus_cli --help` for commands. `sync` creates `corpus/manifest.local.json` and private inputs under ignored directories. Promote a reviewed manifest deliberately if provenance metadata should be versioned; never commit the PDFs, EPUBs, extracted text, rendered pages, private annotations, or reports containing excerpts.

The OAPEN headline set is split into 150 discovery, 50 development, and 100 locked-test books. Standard Ebooks controls remain a separate 40-book score and are never mixed into headline results. Twenty percent of development and locked-test annotations are deterministically flagged for a second reviewer.

The token-protected annotation interface records the canonical title, reading start, semantic section boundaries, selected block labels, running page furniture, body word counts, and sentence-end anchors. Select text on the displayed page before choosing **Label current block** to seed an exact block annotation.

`benchmark-status.json` records only non-copyrighted aggregate smoke diagnostics and whether the locked test has actually run. It must never be treated as a substitute for the private 100-book scorecard.
