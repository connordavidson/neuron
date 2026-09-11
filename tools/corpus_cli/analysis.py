from __future__ import annotations

import statistics
from collections import Counter
from pathlib import Path
from typing import Any

from .common import load_json, utc_now, write_json


def analyze_corpus(manifest_path: Path, extracted_dir: Path, predictions_dir: Path | None, output_path: Path) -> dict[str, Any]:
    manifest = load_json(manifest_path)
    records: list[dict[str, Any]] = []
    warning_counts: Counter[str] = Counter()
    section_counts: Counter[str] = Counter()
    for item in manifest.get("items", []):
        extraction_path = extracted_dir / f"{item['id']}.json"
        if not extraction_path.exists():
            continue
        extraction = load_json(extraction_path)
        pages = extraction.get("structuredPages", [])
        fonts = [span.get("fontSize", 0) for page in pages for span in page.get("spans", []) if span.get("fontSize", 0) > 0]
        records.append({
            "id": item["id"],
            "source": item.get("source"),
            "split": item.get("split"),
            "publisher": item.get("publisher", ""),
            "subjects": item.get("subjects", []),
            "pages": len(pages),
            "spans": sum(len(page.get("spans", [])) for page in pages),
            "outlineEntries": len(extraction.get("outlines", [])),
            "medianFontSize": round(statistics.median(fonts), 3) if fonts else 0,
        })
        if predictions_dir:
            prediction_path = predictions_dir / f"{item['id']}.json"
            if prediction_path.exists():
                prediction = load_json(prediction_path)
                for warning in prediction.get("diagnostics", {}).get("warnings", []):
                    warning_counts[warning] += 1
                for section in prediction.get("sections", []):
                    section_counts[section.get("kind", "unknown")] += 1
    page_counts = [record["pages"] for record in records]
    result = {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "documents": len(records),
        "sources": dict(Counter(record["source"] for record in records)),
        "splits": dict(Counter(record["split"] for record in records)),
        "publishers": len({record["publisher"] for record in records if record["publisher"]}),
        "subjects": len({subject for record in records for subject in record["subjects"]}),
        "pageCounts": {
            "minimum": min(page_counts, default=0),
            "median": statistics.median(page_counts) if page_counts else 0,
            "maximum": max(page_counts, default=0),
        },
        "outlineCoverage": round(sum(record["outlineEntries"] > 0 for record in records) / len(records), 4) if records else 0,
        "sectionKinds": dict(section_counts.most_common()),
        "parserWarnings": dict(warning_counts.most_common()),
        "records": records,
    }
    write_json(output_path, result)
    return result
