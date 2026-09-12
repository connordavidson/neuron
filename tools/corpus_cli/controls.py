from __future__ import annotations

import os
import shutil
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from html import unescape
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from .common import sha256_file, stable_id, utc_now, write_json
from .oapen import USER_AGENT


ATOM = {"atom": "http://www.w3.org/2005/Atom"}
CONTAINER = {"container": "urn:oasis:names:tc:opendocument:xmlns:container"}
OPF = {"opf": "http://www.idpf.org/2007/opf"}
XHTML = {"x": "http://www.w3.org/1999/xhtml"}
CC0_URI = "https://creativecommons.org/publicdomain/zero/1.0/"


def discover_controls(feed_url: str, target: int) -> list[dict[str, Any]]:
    request = Request(feed_url, headers={"User-Agent": USER_AGENT, "Accept": "application/atom+xml"})
    with urlopen(request, timeout=60) as response:
        root = ET.parse(response).getroot()
    result: list[dict[str, Any]] = []
    for entry in root.findall("atom:entry", ATOM):
        title = text_of(entry.find("atom:title", ATOM))
        download = ""
        for link in entry.findall("atom:link", ATOM):
            media_type = link.attrib.get("type", "")
            href = link.attrib.get("href", "")
            if media_type == "application/epub+zip" and href:
                download = urljoin(feed_url, href)
                break
        if not title or not download:
            continue
        authors = [text_of(author.find("atom:name", ATOM)) for author in entry.findall("atom:author", ATOM)]
        source_id = text_of(entry.find("atom:id", ATOM)) or download
        result.append({
            "id": stable_id("standardebooks", source_id),
            "source": "standardebooks",
            "sourceId": source_id,
            "title": title,
            "authors": [author for author in authors if author],
            "publisher": "Standard Ebooks",
            "subjects": [category.attrib.get("term", "") for category in entry.findall("atom:category", ATOM)],
            "language": "en",
            "downloadUrl": download,
            "rightsUri": CC0_URI,
            "rightsCode": "CC0-1.0",
            "rightsEvidence": "Standard Ebooks dedicates its ebook files, markup, and original artwork to the public domain under CC0",
            "catalogedAt": utc_now(),
            "split": "control",
        })
        if len(result) >= target:
            break
    return result


def download_controls(items: list[dict[str, Any]], data_dir: Path) -> list[dict[str, Any]]:
    data_dir.mkdir(parents=True, exist_ok=True)
    result: list[dict[str, Any]] = []
    for item in items:
        destination = data_dir / f"{item['id']}.epub"
        if not destination.exists():
            request = Request(item["downloadUrl"], headers={"User-Agent": USER_AGENT, "Accept": "application/epub+zip"})
            with urlopen(request, timeout=120) as response, tempfile.NamedTemporaryFile(dir=data_dir, delete=False) as temporary:
                shutil.copyfileobj(response, temporary)
                temporary_path = Path(temporary.name)
            try:
                if not zipfile.is_zipfile(temporary_path):
                    raise ValueError(f"{item['id']} did not download as a valid EPUB")
                os.replace(temporary_path, destination)
            finally:
                temporary_path.unlink(missing_ok=True)
        result.append({
            **item,
            "sha256": sha256_file(destination),
            "bytes": destination.stat().st_size,
            "localPath": str(destination.relative_to(data_dir.parent.parent)),
            "downloadedAt": utc_now(),
        })
    return result


@dataclass
class EpubBlock:
    kind: str
    text: str
    level: int = 0


def extract_epub(epub_path: Path) -> tuple[str, list[EpubBlock]]:
    with zipfile.ZipFile(epub_path) as archive:
        container = ET.fromstring(archive.read("META-INF/container.xml"))
        rootfile = container.find(".//container:rootfile", CONTAINER)
        if rootfile is None:
            raise ValueError("EPUB has no package rootfile")
        opf_path = PurePosixPath(rootfile.attrib["full-path"])
        opf = ET.fromstring(archive.read(str(opf_path)))
        title = text_of(opf.find(".//{http://purl.org/dc/elements/1.1/}title")) or epub_path.stem
        manifest = {
            item.attrib.get("id", ""): item.attrib.get("href", "")
            for item in opf.findall(".//opf:manifest/opf:item", OPF)
        }
        blocks: list[EpubBlock] = []
        for itemref in opf.findall(".//opf:spine/opf:itemref", OPF):
            href = manifest.get(itemref.attrib.get("idref", ""))
            if not href:
                continue
            document_path = str(opf_path.parent / PurePosixPath(href.split("#", 1)[0]))
            try:
                root = ET.fromstring(archive.read(document_path))
            except (KeyError, ET.ParseError):
                continue
            body = root.find(".//x:body", XHTML)
            if body is None:
                continue
            for element in body.iter():
                tag = element.tag.rsplit("}", 1)[-1].casefold()
                value = normalize_text(" ".join(element.itertext()))
                if not value:
                    continue
                if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
                    blocks.append(EpubBlock("heading", value, int(tag[1])))
                elif tag in {"p", "blockquote", "li"}:
                    blocks.append(EpubBlock("prose", value))
        return title, dedupe_nested_blocks(blocks)


def render_control(epub_path: Path, output_dir: Path, layouts: list[str]) -> list[Path]:
    try:
        from reportlab.lib.enums import TA_CENTER
        from reportlab.lib.pagesizes import A5, LETTER
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, PageBreak, Spacer
    except ImportError as error:
        raise RuntimeError("reportlab is required; install requirements-corpus.txt") from error

    title, blocks = extract_epub(epub_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []
    styles = getSampleStyleSheet()
    for layout in layouts:
        if layout == "compact":
            page_size, margins, columns = A5, (0.55 * inch,) * 4, 1
        elif layout == "two-column":
            page_size, margins, columns = LETTER, (0.55 * inch,) * 4, 2
        else:
            page_size, margins, columns = LETTER, (0.85 * inch,) * 4, 1
        left, right, top, bottom = margins
        destination = output_dir / f"{epub_path.stem}-{layout}.pdf"
        doc = BaseDocTemplate(str(destination), pagesize=page_size, leftMargin=left, rightMargin=right, topMargin=top, bottomMargin=bottom,
                              title=title, author="Standard Ebooks control renderer")
        frame_gap = 0.25 * inch
        usable_width = page_size[0] - left - right
        frame_width = (usable_width - frame_gap * (columns - 1)) / columns
        frames = [Frame(left + index * (frame_width + frame_gap), bottom, frame_width, page_size[1] - top - bottom, id=f"column-{index}")
                  for index in range(columns)]
        doc.addPageTemplates(PageTemplate(id=layout, frames=frames))
        truth: list[dict[str, Any]] = []

        def after_flowable(flowable: Any) -> None:
            ground_truth = getattr(flowable, "_neuron_ground_truth", None)
            if ground_truth:
                truth.append({**ground_truth, "startPage": doc.page - 1})

        doc.afterFlowable = after_flowable  # type: ignore[method-assign]
        heading_style = ParagraphStyle("ControlHeading", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=18,
                                       leading=22, spaceBefore=14, spaceAfter=10, alignment=TA_CENTER)
        body_style = ParagraphStyle("ControlBody", parent=styles["BodyText"], fontName="Times-Roman", fontSize=10.5,
                                    leading=15, spaceAfter=8)
        story: list[Any] = [Paragraph(escape_xml(title), heading_style), PageBreak()]
        for block in blocks:
            if block.kind == "heading":
                heading = Paragraph(escape_xml(block.text), heading_style)
                heading._neuron_ground_truth = {"title": block.text, "kind": semantic_kind(block.text), "level": max(0, block.level - 1)}
                story.extend([Spacer(1, 8), heading])
            else:
                story.append(Paragraph(escape_xml(block.text), body_style))
        doc.build(story)
        write_json(destination.with_suffix(".ground-truth.json"), {
            "schemaVersion": 1,
            "bookId": epub_path.stem,
            "title": title,
            "layout": layout,
            "sections": truth,
        })
        outputs.append(destination)
    return outputs


def semantic_kind(title: str) -> str:
    value = title.casefold().strip()
    for prefix, kind in (("chapter", "chapter"), ("part", "part"), ("book", "part"), ("appendix", "appendix"),
                         ("introduction", "introduction"), ("preface", "preface"), ("foreword", "foreword"),
                         ("conclusion", "conclusion"), ("epilogue", "epilogue"), ("bibliography", "bibliography"),
                         ("references", "bibliography"), ("index", "index")):
        if value.startswith(prefix):
            return kind
    return "section"


def text_of(element: ET.Element | None) -> str:
    return normalize_text("" if element is None else " ".join(element.itertext()))


def normalize_text(value: str) -> str:
    return " ".join(unescape(value).split())


def escape_xml(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def dedupe_nested_blocks(blocks: list[EpubBlock]) -> list[EpubBlock]:
    result: list[EpubBlock] = []
    for block in blocks:
        if result and block.text == result[-1].text:
            continue
        if result and block.kind == "prose" and result[-1].kind == "prose" and result[-1].text.endswith(block.text):
            continue
        result.append(block)
    return result
