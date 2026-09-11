from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .analysis import analyze_corpus
from .annotation import serve_annotations
from .common import CORPUS_ROOT, REPO_ROOT, load_json, require_python_312
from .controls import render_control
from .evaluation import evaluate_corpus
from .extraction import extract_many
from .manifesting import sync_corpus
from .predictions import run_predictions
from .rendering import render_pdf
from .reporting import write_report


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="corpus", description="Build and evaluate Neuron's private licensed PDF benchmark")
    root.add_argument("--corpus-root", type=Path, default=CORPUS_ROOT)
    commands = root.add_subparsers(dest="command", required=True)

    sync = commands.add_parser("sync", help="discover, download, license-check, deduplicate, stratify, and freeze inputs")
    sync.add_argument("--refresh", action="store_true")
    sync.add_argument("--limit", type=int, help="OAPEN override for a smoke run")
    sync.add_argument("--control-limit", type=int, help="Standard Ebooks override for a smoke run")
    sync.add_argument("--candidate-limit", type=int)
    sync.add_argument("--workers", type=int, default=4)

    extract = commands.add_parser("extract", help="extract lossless structured document JSON")
    extract.add_argument("--id", action="append", dest="ids")
    extract.add_argument("--split", choices=["discovery", "development", "locked-test", "control"])

    render = commands.add_parser("render", help="render PDFs for inspection and create Standard Ebooks controls")
    render.add_argument("--id", action="append", dest="ids")
    render.add_argument("--all-pages", action="store_true")
    render.add_argument("--dpi", type=int, default=120)

    annotate = commands.add_parser("annotate", help="open the local section/block annotation interface")
    annotate.add_argument("--port", type=int, default=8765)
    annotate.add_argument("--no-browser", action="store_true")

    analyze = commands.add_parser("analyze", help="summarize corpus structure and parser failure patterns")
    analyze.add_argument("--parse", action="store_true", help="run the current deterministic parser before analysis")

    evaluate = commands.add_parser("evaluate", help="score predictions against gold annotations")
    evaluate.add_argument("--split", default="locked-test", choices=["development", "locked-test", "control"])
    evaluate.add_argument("--enforce", action="store_true", help="exit nonzero unless the complete split passes every gate")

    report = commands.add_parser("report", help="generate an HTML scorecard from evaluation JSON")
    report.add_argument("--split", default="locked-test", choices=["development", "locked-test", "control"])
    return root


def main(argv: list[str] | None = None) -> int:
    require_python_312()
    args = parser().parse_args(argv)
    corpus_root: Path = args.corpus_root.resolve()
    manifest_path = corpus_root / "manifest.local.json"
    config_path = corpus_root / "config.json"
    if args.command == "sync":
        result = sync_corpus(config_path, manifest_path, args.refresh, args.limit, args.control_limit, args.candidate_limit, args.workers)
        print(json.dumps({"manifest": str(manifest_path), "items": len(result["items"])}, indent=2))
        return 0
    manifest = require_manifest(manifest_path)
    if args.command == "extract":
        paths = selected_pdf_paths(manifest, corpus_root, args.ids, args.split)
        outputs = extract_many(paths, corpus_root / "extracted")
        print(f"Extracted {len(outputs)} PDFs to {corpus_root / 'extracted'}")
        return 0
    if args.command == "render":
        items = selected_items(manifest, args.ids, None)
        outputs: list[Path] = []
        layouts = load_json(config_path)["standardEbooks"]["layouts"]
        for item in items:
            source = corpus_root / item["localPath"]
            if item["source"] == "standardebooks":
                outputs.extend(render_control(source, corpus_root / "rendered" / "controls" / item["id"], layouts))
            else:
                outputs.extend(render_pdf(source, corpus_root / "rendered" / "pages" / item["id"], args.dpi,
                                          None, None if args.all_pages else min(9, int(item.get("pageCount", 10)) - 1)))
        print(f"Rendered {len(outputs)} files")
        return 0
    if args.command == "annotate":
        serve_annotations(manifest_path, corpus_root / "extracted", corpus_root / "annotations" / "private", args.port, not args.no_browser)
        return 0
    if args.command == "analyze":
        predictions = corpus_root / "predictions"
        if args.parse:
            run_predictions(corpus_root / "extracted", predictions)
        result = analyze_corpus(manifest_path, corpus_root / "extracted", predictions if predictions.exists() else None,
                                corpus_root / "reports" / "private" / "analysis.json")
        print(json.dumps({key: result[key] for key in ("documents", "publishers", "subjects", "outlineCoverage")}, indent=2))
        return 0
    if args.command == "evaluate":
        output = corpus_root / "reports" / "private" / f"evaluation-{args.split}.json"
        result = evaluate_corpus(manifest_path, corpus_root / "annotations" / "private", corpus_root / "predictions", output, args.split)
        print(json.dumps({"complete": result["complete"], "promotionAllowed": result["promotionAllowed"], "metrics": result["metrics"]}, indent=2))
        return 2 if args.enforce and not result["promotionAllowed"] else 0
    if args.command == "report":
        evaluation = corpus_root / "reports" / "private" / f"evaluation-{args.split}.json"
        if not evaluation.exists():
            raise RuntimeError(f"Run corpus evaluate --split {args.split} first")
        destination = corpus_root / "reports" / "private" / f"scorecard-{args.split}.html"
        write_report(evaluation, destination)
        print(destination)
        return 0
    return 1


def require_manifest(path: Path) -> dict:
    if not path.exists():
        raise RuntimeError("Run corpus sync first")
    return load_json(path)


def selected_items(manifest: dict, ids: list[str] | None, split: str | None) -> list[dict]:
    wanted = set(ids or [])
    return [item for item in manifest.get("items", []) if (not wanted or item["id"] in wanted) and (not split or item.get("split") == split)]


def selected_pdf_paths(manifest: dict, root: Path, ids: list[str] | None, split: str | None) -> list[Path]:
    paths: list[Path] = []
    for item in selected_items(manifest, ids, split):
        source = root / item["localPath"]
        if source.suffix.casefold() == ".pdf":
            paths.append(source)
        elif item["source"] == "standardebooks":
            paths.extend(sorted((root / "rendered" / "controls" / item["id"]).glob("*.pdf")))
    return paths


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
