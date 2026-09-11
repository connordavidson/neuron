from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable

from .common import load_json, normalize_key, utc_now, write_json


GATES = {
    "bookTitleAccuracy": {"operator": ">=", "target": 0.98},
    "chapterPartPrecision": {"operator": ">=", "target": 0.95},
    "chapterPartRecall": {"operator": ">=", "target": 0.95},
    "semanticSectionMacroF1": {"operator": ">=", "target": 0.92},
    "sectionBoundaryWithinOnePage": {"operator": ">=", "target": 0.97},
    "readingStartWithinOnePage": {"operator": ">=", "target": 0.97},
    "bodyWordRetention": {"operator": ">=", "target": 0.995},
    "headerFooterLeakage": {"operator": "<=", "target": 0.002},
    "sentenceBoundaryF1": {"operator": ">=", "target": 0.98},
}


def evaluate_corpus(manifest_path: Path, annotations_dir: Path, predictions_dir: Path, output_path: Path,
                    split: str = "locked-test") -> dict[str, Any]:
    manifest = load_json(manifest_path)
    items = [item for item in manifest.get("items", []) if item.get("split") == split]
    per_book: list[dict[str, Any]] = []
    for item in items:
        gold_path = annotations_dir / f"{item['id']}.json"
        prediction_path = predictions_dir / f"{item['id']}.json"
        if not gold_path.exists() or not prediction_path.exists():
            continue
        per_book.append(score_book(item["id"], load_json(gold_path), load_json(prediction_path)))
    metrics = aggregate_metrics(per_book)
    gates = {
        name: {**rule, "actual": metrics.get(name), "passed": passes(metrics.get(name), rule)}
        for name, rule in GATES.items()
    }
    result = {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "split": split,
        "expectedBooks": len(items),
        "scoredBooks": len(per_book),
        "complete": len(per_book) == len(items) and bool(items),
        "metrics": metrics,
        "gates": gates,
        "promotionAllowed": len(per_book) == len(items) and bool(items) and all(gate["passed"] for gate in gates.values()),
        "books": per_book,
    }
    write_json(output_path, result)
    return result


def score_book(book_id: str, gold: dict[str, Any], prediction: dict[str, Any]) -> dict[str, Any]:
    gold_sections = gold.get("sections", [])
    predicted_sections = prediction.get("sections", [])
    chapter_kinds = {"chapter", "part"}
    chapter_scores = match_sets(
        [section for section in gold_sections if section.get("kind") in chapter_kinds],
        [section for section in predicted_sections if section.get("kind") in chapter_kinds],
        lambda left, right: left.get("kind") == right.get("kind") and title_similarity(left.get("title", ""), right.get("title", "")) >= 0.72
        and abs(page_of(left) - page_of(right)) <= 1,
    )
    section_scores = match_sets(
        gold_sections,
        predicted_sections,
        lambda left, right: left.get("kind") == right.get("kind") and abs(page_of(left) - page_of(right)) <= 1,
    )
    exact_boundaries = match_sets(
        gold_sections,
        predicted_sections,
        lambda left, right: left.get("kind") == right.get("kind") and abs(page_of(left) - page_of(right)) == 0,
    )
    predicted_units = prediction.get("readingUnits", [])
    reading_start_index = int(prediction.get("readingStart", 0) or 0)
    predicted_start = (predicted_units[reading_start_index].get("anchor", {}).get("pageIndex", 0)
                       if 0 <= reading_start_index < len(predicted_units) else 0)
    predicted_words = sum(int(unit.get("wordCount", len(re.findall(r"\S+", unit.get("text", ""))))) for unit in predicted_units)
    gold_words = int(gold.get("bodyWordCount", 0) or 0)
    furniture = {normalize_key(value) for value in gold.get("runningFurniture", []) if normalize_key(value)}
    predicted_text = " ".join(unit.get("text", "") for unit in predicted_units)
    leaked_words = sum(len(value.split()) for value in furniture if value in normalize_key(predicted_text))
    gold_sentence_ends = set(gold.get("sentenceEnds", []))
    predicted_sentence_ends = set(prediction.get("sentenceEnds", []))
    sentence = set_f1(gold_sentence_ends, predicted_sentence_ends)
    per_kind = semantic_f1_by_kind(gold_sections, predicted_sections)
    return {
        "id": book_id,
        "bookTitleAccuracy": float(normalize_key(gold.get("title", "")) == normalize_key(prediction.get("metadata", {}).get("title", {}).get("value", ""))),
        "chapterPartPrecision": chapter_scores["precision"],
        "chapterPartRecall": chapter_scores["recall"],
        "semanticSectionF1ByKind": per_kind,
        "sectionBoundaryExact": exact_boundaries["recall"],
        "sectionBoundaryWithinOnePage": section_scores["recall"],
        "readingStartWithinOnePage": float(abs(predicted_start - int(gold.get("readingStartPage", 0))) <= 1),
        "bodyWordRetention": min(1.0, predicted_words / gold_words) if gold_words else 1.0,
        "headerFooterLeakage": leaked_words / max(1, predicted_words),
        "sentenceBoundaryPrecision": sentence["precision"],
        "sentenceBoundaryRecall": sentence["recall"],
        "sentenceBoundaryF1": sentence["f1"],
    }


def aggregate_metrics(books: list[dict[str, Any]]) -> dict[str, float | None]:
    simple = [
        "bookTitleAccuracy", "chapterPartPrecision", "chapterPartRecall", "sectionBoundaryExact",
        "sectionBoundaryWithinOnePage", "readingStartWithinOnePage", "bodyWordRetention",
        "headerFooterLeakage", "sentenceBoundaryPrecision", "sentenceBoundaryRecall", "sentenceBoundaryF1",
    ]
    result: dict[str, float | None] = {
        name: round(sum(float(book[name]) for book in books) / len(books), 6) if books else None for name in simple
    }
    kind_values: dict[str, list[float]] = defaultdict(list)
    for book in books:
        for kind, score in book.get("semanticSectionF1ByKind", {}).items():
            kind_values[kind].append(float(score))
    per_kind = {kind: sum(values) / len(values) for kind, values in kind_values.items()}
    result["semanticSectionMacroF1"] = round(sum(per_kind.values()) / len(per_kind), 6) if per_kind else None
    return result


def semantic_f1_by_kind(gold: list[dict[str, Any]], predicted: list[dict[str, Any]]) -> dict[str, float]:
    result: dict[str, float] = {}
    for kind in sorted({section.get("kind", "unknown") for section in [*gold, *predicted]}):
        score = match_sets(
            [section for section in gold if section.get("kind") == kind],
            [section for section in predicted if section.get("kind") == kind],
            lambda left, right: abs(page_of(left) - page_of(right)) <= 1,
        )
        result[kind] = score["f1"]
    return result


def match_sets(gold: list[Any], predicted: list[Any], matches: Callable[[Any, Any], bool]) -> dict[str, float]:
    used: set[int] = set()
    true_positive = 0
    for expected in gold:
        index = next((index for index, actual in enumerate(predicted) if index not in used and matches(expected, actual)), None)
        if index is not None:
            used.add(index)
            true_positive += 1
    precision = true_positive / len(predicted) if predicted else (1.0 if not gold else 0.0)
    recall = true_positive / len(gold) if gold else (1.0 if not predicted else 0.0)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


def set_f1(gold: set[str], predicted: set[str]) -> dict[str, float]:
    intersection = len(gold & predicted)
    precision = intersection / len(predicted) if predicted else (1.0 if not gold else 0.0)
    recall = intersection / len(gold) if gold else (1.0 if not predicted else 0.0)
    return {"precision": precision, "recall": recall, "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0}


def title_similarity(left: str, right: str) -> float:
    a = set(normalize_key(left).split())
    b = set(normalize_key(right).split())
    return 2 * len(a & b) / (len(a) + len(b)) if a and b else 0.0


def page_of(section: dict[str, Any]) -> int:
    return int(section.get("startPage", section.get("pageIndex", 0)) or 0)


def passes(actual: float | None, rule: dict[str, Any]) -> bool:
    if actual is None:
        return False
    return actual >= rule["target"] if rule["operator"] == ">=" else actual <= rule["target"]
