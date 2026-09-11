from __future__ import annotations

from pathlib import Path
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
                "links": extract_links(page),
            })
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
    }


def extract_many(input_paths: list[Path], output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []
    for pdf_path in input_paths:
        destination = output_dir / f"{pdf_path.stem}.json"
        write_json(destination, extract_pdf(pdf_path))
        outputs.append(destination)
    return outputs


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


def extract_links(page: Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for link in getattr(page, "hyperlinks", []) or []:
        result.append({
            "bounds": {
                "x": round(float(link.get("x0") or 0), 3),
                "y": round(float(link.get("top") or 0), 3),
                "width": round(float(link.get("x1") or 0) - float(link.get("x0") or 0), 3),
                "height": round(float(link.get("bottom") or 0) - float(link.get("top") or 0), 3),
            },
            **({"url": link["uri"]} if link.get("uri") else {}),
            **({"destinationPageIndex": int(link["page"]) - 1} if link.get("page") else {}),
        })
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
