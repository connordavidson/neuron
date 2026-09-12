"""Unlabelled corpus diagnostics. These are proxies, never gold accuracy scores."""
from __future__ import annotations

import argparse
import re
from collections import Counter
from pathlib import Path

from .common import load_json, normalize_key, write_json


def audit(root: Path, destination: Path, predictions: Path | None = None) -> dict:
    records = []
    for item in load_json(root / "manifest.local.json")["items"]:
        path = (predictions or root / "predictions") / f"{item['id']}.json"
        if not path.exists():
            continue
        parsed = load_json(path)
        extracted = load_json(root / "extracted" / path.name)
        units = parsed["readingUnits"]
        title = parsed["metadata"]["title"]["value"]
        words = lambda value: re.findall(r"\w+", value.casefold())
        source_words = sum(len(words(page)) for page in extracted["pages"])
        retained = sum(len(words(unit["text"])) for unit in units)
        prose = sum(len(words(block["text"])) for block in parsed["blocks"] if block["kind"] == "prose")
        source_outline = [entry for entry in extracted.get("outlines", []) if entry["pageIndex"] >= 0]
        records.append({
            "id": item["id"], "catalogTitle": item["title"], "parsedTitle": title,
            "parserVersion": parsed["diagnostics"]["parserVersion"],
            "titleAgreement": normalize_key(title) == normalize_key(item["title"]),
            "pdfMetadataTitle": extracted.get("metadata", {}).get("title"),
            "publisher": item.get("publisher", ""), "pages": len(extracted["pages"]),
            "sourceWords": source_words, "readingWords": retained,
            "readingToSourceRatio": round(retained / max(1, source_words), 4),
            "unassignedProseWords": max(0, prose - retained),
            "units": len(units), "navigation": len(parsed["chapters"]),
            "sections": len(parsed["sections"]), "outlineEntries": len(source_outline),
            "startPage": units[parsed["readingStart"]]["anchor"]["pageIndex"] + 1 if units else None,
            "oversizedCards": sum(unit["wordCount"] > 250 for unit in units),
            "maxCardWords": max((unit["wordCount"] for unit in units), default=0),
            "invalidCardCounts": sum(unit["sentenceCount"] not in (1, 2) for unit in units),
            "kinds": dict(Counter(section["kind"] for section in parsed["sections"])),
            "removedFurniture": parsed["diagnostics"]["counts"]["removedFurniture"],
            "warnings": parsed["diagnostics"]["warnings"],
        })
    result = {"status": "unlabelled diagnostic proxies, not accuracy", "books": len(records),
              "pages": sum(r["pages"] for r in records),
              "catalogTitleAgreement": sum(r["titleAgreement"] for r in records),
              "emptyBooks": sum(r["units"] == 0 for r in records),
              "noNavigation": sum(r["navigation"] == 0 for r in records),
              "readingWords": sum(r["readingWords"] for r in records),
              "oversizedCards": sum(r["oversizedCards"] for r in records),
              "invalidCardCounts": sum(r["invalidCardCounts"] for r in records), "records": records}
    write_json(destination, result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, default=Path("corpus"))
    parser.add_argument("--predictions", type=Path)
    args = parser.parse_args()
    result = audit(args.corpus_root, args.output, args.predictions)
    print({k: v for k, v in result.items() if k != "records"})
    for record in result["records"]:
        print(record["id"], record["pages"], record["navigation"], record["readingToSourceRatio"],
              record["startPage"], record["catalogTitle"], "=>", record["parsedTitle"])
