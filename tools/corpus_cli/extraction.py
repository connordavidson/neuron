from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import subprocess
import sys
from typing import Any

from .common import utc_now, write_json


def extract_pdf(pdf_path: Path) -> dict[str, Any]:
    try:
        import pdfplumber
        from pypdf import PdfReader
    except ImportError as error:
        raise RuntimeError("pdfplumber and pypdf are required; install requirements-corpus.txt") from error

    reader = PdfReader(pdf_path)
    labels = page_labels(reader)
    structured_pages: list[dict[str, Any]] = []
    page_texts: list[str] = []
    page_line_fonts: list[list[float]] = []
    warnings: list[str] = []
    with pdfplumber.open(pdf_path) as document:
        for page_index, page in enumerate(document.pages):
            lines = group_chars_into_lines(page.chars)
            text_parts: list[str] = []
            spans: list[dict[str, Any]] = []
            line_fonts: list[float] = []
            source_offset = 0
            for line_index, line in enumerate(lines):
                line_text = "".join(span["text"] for span in line).strip()
                if not line_text:
                    continue
                if text_parts:
                    text_parts.append("\n")
                    source_offset += 1
                line_start = source_offset
                text_parts.append(line_text)
                source_offset += len(line_text)
                cursor = line_start
                line_fonts.append(max((float(span.get("size") or 0) for span in line), default=0))
                for raw in line:
                    value = raw["text"]
                    if not value:
                        continue
                    position = line_text.find(value.strip(), max(0, cursor - line_start)) if value.strip() else -1
                    start = line_start + position if position >= 0 else cursor
                    end = start + len(value.strip())
                    font_name = str(raw.get("fontname") or "")
                    spans.append({
                        "text": value.strip(),
                        "sourceStart": start,
                        "sourceEnd": end,
                        "lineIndex": line_index,
                        "bounds": {
                            "x": round(float(raw.get("x0") or 0), 3),
                            "y": round(float(raw.get("top") or 0), 3),
                            "width": round(float(raw.get("x1") or 0) - float(raw.get("x0") or 0), 3),
                            "height": round(float(raw.get("bottom") or 0) - float(raw.get("top") or 0), 3),
                        },
                        "fontName": font_name,
                        "fontSize": round(float(raw.get("size") or 0), 3),
                        "bold": "bold" in font_name.casefold() or "black" in font_name.casefold(),
                        "italic": "italic" in font_name.casefold() or "oblique" in font_name.casefold(),
                        "color": color_value(raw.get("non_stroking_color")),
                    })
                    cursor = max(cursor, end)
            text = "".join(text_parts)
            page_texts.append(text)
            page_line_fonts.append(line_fonts)
            structured_pages.append({
                "index": page_index,
                "label": labels[page_index] if page_index < len(labels) else str(page_index + 1),
                "width": round(float(page.width), 3),
                "height": round(float(page.height), 3),
                "rotation": int(page.rotation or 0),
                "text": text,
                "spans": spans,
                "links": extract_pdf_links(reader, page_index, warnings),
            })
            page.close()
    metadata = extract_metadata(reader)
    return {
        "schemaVersion": 1,
        "extractedAt": utc_now(),
        "sourceFile": pdf_path.name,
        "title": metadata.get("title", ""),
        "pages": page_texts,
        "pageLineFonts": page_line_fonts,
        "structuredPages": structured_pages,
        "outlines": extract_outline(reader),
        "metadata": metadata,
        "extractionWarnings": warnings,
    }


def extract_many(input_paths: list[Path], output_dir: Path, workers: int = 4, timeout: float = 1800) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []

    def extract_one(pdf_path: Path) -> Path:
        destination = output_dir / f"{pdf_path.stem}.json"
        # A malformed object graph must not hold the entire corpus run hostage.
        # Each worker owns a killable process and writes its JSON atomically.
        subprocess.run([sys.executable, "-m", "tools.corpus_cli.extraction", str(pdf_path), str(destination)],
                       check=True, timeout=timeout, capture_output=True, text=True)
        return destination

    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {executor.submit(extract_one, path): path for path in input_paths}
        failures: list[str] = []
        for completed, future in enumerate(as_completed(futures), 1):
            source = futures[future]
            try:
                outputs.append(future.result())
                print(f"[{completed}/{len(futures)}] extracted {source.name}")
            except Exception as error:
                detail = error.stderr[-2000:] if isinstance(error, subprocess.CalledProcessError) and error.stderr else str(error)
                print(f"[{completed}/{len(futures)}] failed {source.name}: {detail}")
                failures.append(source.name)
    if failures:
        raise RuntimeError(f"Extraction failed for {len(failures)} PDFs: {', '.join(failures[:8])}")
    return sorted(outputs)


def group_chars_into_lines(chars: list[dict[str, Any]], tolerance: float = 2.5) -> list[list[dict[str, Any]]]:
    rows: list[list[dict[str, Any]]] = []
    for char in sorted(chars, key=lambda item: (round(float(item.get("top") or 0) / tolerance), float(item.get("x0") or 0))):
        top = float(char.get("top") or 0)
        row = next((candidate for candidate in reversed(rows[-4:]) if abs(float(candidate[0].get("top") or 0) - top) <= tolerance), None)
        if row is None:
            row = []
            rows.append(row)
        row.append(char)
    result: list[list[dict[str, Any]]] = []
    for row in sorted(rows, key=lambda group: (float(group[0].get("top") or 0), float(group[0].get("x0") or 0))):
        ordered = sorted(row, key=lambda item: float(item.get("x0") or 0))
        spans: list[dict[str, Any]] = []
        current: dict[str, Any] | None = None
        for char in ordered:
            font = str(char.get("fontname") or "")
            size = round(float(char.get("size") or 0), 2)
            gap = float(char.get("x0") or 0) - float(current.get("x1") or 0) if current else 0
            same_style = current and current["fontname"] == font and abs(float(current["size"]) - size) <= 0.05
            if current and same_style and gap <= max(3, size * 0.45):
                if gap > size * 0.22 and not str(current["text"]).endswith(" "):
                    current["text"] += " "
                current["text"] += str(char.get("text") or "")
                current["x1"] = float(char.get("x1") or current["x1"])
                current["bottom"] = max(float(current["bottom"]), float(char.get("bottom") or 0))
            else:
                current = {
                    "text": str(char.get("text") or ""),
                    "x0": float(char.get("x0") or 0),
                    "x1": float(char.get("x1") or 0),
                    "top": float(char.get("top") or 0),
                    "bottom": float(char.get("bottom") or 0),
                    "size": size,
                    "fontname": font,
                    "non_stroking_color": char.get("non_stroking_color"),
                }
                spans.append(current)
        result.append(spans)
    return result


def extract_pdf_links(reader: Any, page_index: int, warnings: list[str]) -> list[dict[str, Any]]:
    """Resolve only link fields, never the recursively linked annotation graph."""
    page = reader.pages[page_index]
    result = []
    try:
        annotations = page.get("/Annots", []) or []
        if hasattr(annotations, "get_object"):
            annotations = annotations.get_object()
        if not isinstance(annotations, (list, tuple)):
            raise ValueError("invalid annotation array")
    except Exception as error:
        warnings.append(f"Page {page_index + 1}: links skipped ({type(error).__name__}); page text retained")
        return result
    for reference in annotations:
        try:
            annotation = reference.get_object()
            if annotation.get("/Subtype") != "/Link":
                continue
            rect = annotation.get("/Rect")
            if not rect or len(rect) != 4:
                continue
            action = annotation.get("/A", {}) or {}
            if hasattr(action, "get_object"):
                action = action.get_object()
            uri = action.get("/URI") if action.get("/S") == "/URI" else None
            link = {"bounds": {"x": float(rect[0]), "y": float(page.mediabox.top) - float(rect[3]),
                               "width": float(rect[2]) - float(rect[0]), "height": float(rect[3]) - float(rect[1])}}
            if isinstance(uri, str):
                link["url"] = uri
            elif uri is not None:
                warnings.append(f"Page {page_index + 1}: unreadable link URI; geometry and page text retained")
            destination = annotation.get("/Dest") or action.get("/D")
            if isinstance(destination, (list, tuple)) and destination:
                target = reader.get_page_number(destination[0].get_object())
                if target is not None and target >= 0:
                    link["destinationPageIndex"] = target
            result.append(link)
        except Exception as error:
            warnings.append(f"Page {page_index + 1}: link skipped ({type(error).__name__}); page text retained")
    return result


def extract_outline(reader: Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []

    def walk(values: list[Any], level: int) -> None:
        for value in values:
            if isinstance(value, list):
                walk(value, level + 1)
                continue
            try:
                page_index = reader.get_destination_page_number(value)
            except Exception:
                page_index = -1
            title = str(getattr(value, "title", "") or "").strip()
            if title:
                result.append({"title": title, "pageIndex": page_index, "level": level})

    try:
        walk(reader.outline or [], 0)
    except Exception:
        return []
    return result


def extract_metadata(reader: Any) -> dict[str, Any]:
    raw = reader.metadata or {}
    mapping = {
        "title": "/Title",
        "author": "/Author",
        "subject": "/Subject",
        "creator": "/Creator",
        "producer": "/Producer",
        "creationDate": "/CreationDate",
        "modificationDate": "/ModDate",
    }
    result = {key: str(raw.get(source) or "").strip() for key, source in mapping.items()}
    keywords = str(raw.get("/Keywords") or "").strip()
    if keywords:
        result["keywords"] = [value.strip() for value in keywords.replace(";", ",").split(",") if value.strip()]
    return {key: value for key, value in result.items() if value}


def page_labels(reader: Any) -> list[str]:
    try:
        values = list(reader.page_labels)
        if len(values) == len(reader.pages):
            return [str(value) for value in values]
    except Exception:
        pass
    return [str(index + 1) for index in range(len(reader.pages))]


def color_value(value: Any) -> str | None:
    if not isinstance(value, (tuple, list)):
        return None
    channels = list(value)
    if len(channels) == 1:
        channels *= 3
    if len(channels) < 3:
        return None
    return "#" + "".join(f"{max(0, min(255, round(float(channel) * 255))):02X}" for channel in channels[:3])


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python -m tools.corpus_cli.extraction SOURCE.pdf DESTINATION.json")
    write_json(Path(sys.argv[2]), extract_pdf(Path(sys.argv[1])))
