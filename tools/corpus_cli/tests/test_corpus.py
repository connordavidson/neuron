from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
import subprocess
from unittest.mock import patch
from pathlib import Path

from tools.corpus_cli.common import load_json, write_json
from tools.corpus_cli.controls import extract_epub, render_control
from tools.corpus_cli.evaluation import evaluate_corpus
from tools.corpus_cli.extraction import extract_pdf, extract_pdf_links, extract_many
from tools.corpus_cli.licenses import canonical_rights_uri
from tools.corpus_cli.manifesting import assign_splits
from tools.corpus_cli.oapen import candidate_from_item, stratified_sample
from tools.corpus_cli.rendering import render_pdf
from tools.corpus_cli.reporting import write_report


class CorpusTests(unittest.TestCase):
    def test_link_extraction_ignores_unrelated_recursive_annotations(self) -> None:
        from pypdf import PdfWriter
        from pypdf.generic import ArrayObject, DictionaryObject, NameObject, NumberObject, TextStringObject
        writer = PdfWriter()
        page = writer.add_blank_page(width=612, height=792)
        link = DictionaryObject({NameObject('/Subtype'): NameObject('/Link'),
            NameObject('/Rect'): ArrayObject([NumberObject(n) for n in [10, 20, 100, 40]]),
            NameObject('/A'): DictionaryObject({NameObject('/S'): NameObject('/URI'),
                NameObject('/URI'): TextStringObject('https://example.org/book')})})
        link[NameObject('/Unrelated')] = link  # Must never walk this object graph.
        page[NameObject('/Annots')] = ArrayObject([link, NumberObject(7)])
        warnings = []
        links = extract_pdf_links(writer, 0, warnings)
        self.assertEqual(links[0]['url'], 'https://example.org/book')
        self.assertEqual(links[0]['bounds']['y'], 752)
        self.assertEqual(len(warnings), 1)

    def test_extraction_workers_have_a_timeout_and_report_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch('tools.corpus_cli.extraction.subprocess.run') as run:
            run.side_effect = subprocess.TimeoutExpired('extract', 1)
            with self.assertRaisesRegex(RuntimeError, 'Extraction failed for 1 PDFs'):
                extract_many([Path('slow.pdf')], Path(temporary), workers=1, timeout=1)
            self.assertEqual(run.call_args.kwargs['timeout'], 1)

    def test_oapen_discovery_rejects_chapter_level_records(self) -> None:
        def item(publication_type: str) -> dict:
            return {
                "uuid": "source",
                "metadata": [
                    {"key": "dc.type", "value": publication_type},
                    {"key": "dc.language", "value": "English"},
                    {"key": "dc.title", "value": "A Whole Work"},
                ],
                "bitstreams": [{
                    "mimeType": "application/pdf",
                    "bundleName": "ORIGINAL",
                    "retrieveLink": "/bitstream/book.pdf",
                    "metadata": [{"key": "dc.rights.uri", "value": "https://creativecommons.org/licenses/by/4.0/"}],
                }],
            }

        endpoint = "https://library.oapen.org/rest/search"
        self.assertIsNone(candidate_from_item(item("chapter"), endpoint))
        self.assertEqual(candidate_from_item(item("book"), endpoint)["publicationType"], "book")

    def test_license_allowlist_is_exact_and_restrictive_variants_are_rejected(self) -> None:
        self.assertEqual(canonical_rights_uri("http://creativecommons.org/licenses/by/4.0"),
                         "https://creativecommons.org/licenses/by/4.0/")
        self.assertEqual(canonical_rights_uri("https://creativecommons.org/licenses/by/4.0/legalcode"),
                         "https://creativecommons.org/licenses/by/4.0/")
        for value in ("https://creativecommons.org/licenses/by-nc/4.0/",
                      "https://creativecommons.org/licenses/by-nd/4.0/",
                      "https://creativecommons.org/licenses/by-sa/4.0/", "unknown"):
            self.assertIsNone(canonical_rights_uri(value))

    def test_split_sizes_and_stratified_selection_are_deterministic(self) -> None:
        items = [{
            "id": f"{index:020x}", "publisher": f"Publisher {index % 24}",
            "subjects": [f"Subject {index % 12}"], "pageTier": ("short", "medium", "long")[index % 3],
            "hasOutline": bool(index % 2),
        } for index in range(320)]
        selected = stratified_sample(items, 300)
        assign_splits(selected, {"discovery": 150, "development": 50, "lockedTest": 100})
        counts = {name: sum(item["split"] == name for item in selected)
                  for name in ("discovery", "development", "locked-test")}
        self.assertEqual(counts, {"discovery": 150, "development": 50, "locked-test": 100})
        self.assertEqual([item["id"] for item in selected],
                         [item["id"] for item in stratified_sample(items, 300)])

    def test_generated_pdf_extracts_all_required_structural_fields_and_renders(self) -> None:
        from reportlab.lib.pagesizes import LETTER
        from reportlab.pdfgen import canvas

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "fixture.pdf"
            drawing = canvas.Canvas(str(source), pagesize=LETTER)
            drawing.setTitle("Fixture Book")
            drawing.setAuthor("Test Author")
            for page_index, heading in enumerate(("TITLE PAGE", "COPYRIGHT", "CHAPTER ONE")):
                drawing.setFont("Helvetica-Bold", 20)
                drawing.drawCentredString(306, 720, heading)
                drawing.setFont("Times-Roman", 11)
                drawing.drawString(72, 660, "First complete sentence. Second complete sentence.")
                drawing.drawCentredString(306, 36, str(page_index + 1))
                drawing.showPage()
            drawing.save()
            extraction = extract_pdf(source)
            self.assertEqual(extraction["metadata"]["title"], "Fixture Book")
            self.assertEqual(len(extraction["structuredPages"]), 3)
            self.assertTrue(all(page["spans"] for page in extraction["structuredPages"]))
            self.assertTrue(all({"bounds", "fontName", "fontSize", "sourceStart", "sourceEnd"} <= set(page["spans"][0])
                                for page in extraction["structuredPages"]))
            rendered = render_pdf(source, root / "rendered", first_page=0, last_page=0)
            self.assertEqual(len(rendered), 1)
            self.assertGreater(rendered[0].stat().st_size, 1000)

    def test_standard_ebook_control_uses_navigation_headings_as_ground_truth(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            epub = root / "control.epub"
            with zipfile.ZipFile(epub, "w") as archive:
                archive.writestr("META-INF/container.xml", '''<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf"/></rootfiles></container>''')
                archive.writestr("EPUB/package.opf", '''<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Control Book</dc:title></metadata><manifest><item id="c1" href="chapter.xhtml"/></manifest><spine><itemref idref="c1"/></spine></package>''')
                archive.writestr("EPUB/chapter.xhtml", '''<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter One</h1><p>One sentence. Two sentences.</p></body></html>''')
            title, blocks = extract_epub(epub)
            self.assertEqual(title, "Control Book")
            self.assertEqual(blocks[0].text, "Chapter One")
            outputs = render_control(epub, root / "controls", ["trade", "two-column"])
            self.assertEqual(len(outputs), 2)
            truth = load_json(outputs[0].with_suffix(".ground-truth.json"))
            self.assertEqual(truth["sections"][0]["title"], "Chapter One")

    def test_evaluation_and_html_report_enforce_locked_test_gates(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "manifest.json"
            annotations = root / "annotations"
            predictions = root / "predictions"
            annotations.mkdir()
            predictions.mkdir()
            write_json(manifest, {"items": [{"id": "book", "split": "locked-test"}]})
            write_json(annotations / "book.json", {
                "title": "Exact Book", "readingStartPage": 2, "bodyWordCount": 4,
                "runningFurniture": ["Exact Book"], "sentenceEnds": ["a", "b"],
                "sections": [{"title": "Chapter One", "kind": "chapter", "startPage": 2, "level": 1}],
            })
            write_json(predictions / "book.json", {
                "metadata": {"title": {"value": "Exact Book"}}, "readingStart": 0, "sentenceEnds": ["a", "b"],
                "readingUnits": [{"text": "Four retained body words", "wordCount": 4, "anchor": {"pageIndex": 2}}],
                "sections": [{"title": "Chapter One", "kind": "chapter", "startPage": 2}],
            })
            evaluation_path = root / "evaluation.json"
            result = evaluate_corpus(manifest, annotations, predictions, evaluation_path)
            self.assertTrue(result["promotionAllowed"])
            report = write_report(evaluation_path, root / "scorecard.html")
            self.assertIn("Parser reliability", report.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
