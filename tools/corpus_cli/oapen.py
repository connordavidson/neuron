from __future__ import annotations

import gzip
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urljoin
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .common import normalize_key, sha256_file, stable_id, unique, utc_now
from .licenses import find_allowed_rights


USER_AGENT = "NeuronParserBenchmark/0.1 (+https://github.com/connordavidson/neuron)"


def discover_oapen(config: dict[str, Any], candidate_limit: int) -> list[dict[str, Any]]:
    endpoint = config["searchEndpoint"]
    query = config.get("query", "dc.language.iso:eng")
    discovered: list[dict[str, Any]] = []
    offset = 0
    # Expanded OAPEN records are large. Ten-record pages are consistently more
    # reliable than the nominal 100-record maximum and make progress visible.
    page_size = min(10, max(1, candidate_limit))
    while len(discovered) < candidate_limit:
        url = f"{endpoint}?{urlencode({'query': query, 'expand': 'metadata,bitstreams', 'limit': page_size, 'offset': offset})}"
        payload = fetch_json(url)
        items = payload if isinstance(payload, list) else payload.get("items", payload.get("results", []))
        if not items:
            break
        for item in items:
            candidate = candidate_from_item(item, endpoint)
            if candidate:
                discovered.append(candidate)
        print(f"Catalog: {len(discovered)}/{candidate_limit} eligible whole books ({offset + len(items)} records checked)")
        if len(items) < page_size:
            break
        offset += len(items)
    return dedupe_metadata(discovered)[:candidate_limit]


def fetch_json(url: str, attempts: int = 4) -> Any:
    curl = shutil.which("curl")
    if curl:
        completed = subprocess.run([
            curl, "-fsSL", "--compressed", "--connect-timeout", "12", "--max-time", "30",
            "--retry", "1", "--retry-delay", "2", "--retry-all-errors",
            "-H", "Accept: application/json", "-H", f"User-Agent: {USER_AGENT}", url,
        ], check=True, capture_output=True)
        return json.loads(completed.stdout)
    request = Request(url, headers={
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "Connection": "close",
        "User-Agent": USER_AGENT,
    })
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=120) as response:
                payload = response.read()
                if response.headers.get("Content-Encoding", "").casefold() == "gzip":
                    payload = gzip.decompress(payload)
                return json.loads(payload)
        except (TimeoutError, URLError, HTTPError):
            if attempt + 1 >= attempts:
                raise
            delay = 2 ** attempt
            print(f"OAPEN catalog request timed out; retrying in {delay}s")
            time.sleep(delay)
    raise RuntimeError("OAPEN catalog request exhausted retries")


def candidate_from_item(item: dict[str, Any], endpoint: str) -> dict[str, Any] | None:
    metadata = metadata_map(item.get("metadata", []))
    language = " ".join(values(metadata, "dc.language", "dc.language.iso")).casefold()
    if language and not re.search(r"\b(?:en|eng|english)\b", language):
        return None
    publication_types = {normalize_key(value) for value in values(metadata, "dc.type")}
    if "book" not in publication_types:
        return None
    bitstreams = item.get("bitstreams", []) or []
    pdfs = [bitstream for bitstream in bitstreams if bitstream.get("mimeType") == "application/pdf"
            and bitstream.get("bundleName", "ORIGINAL") == "ORIGINAL"]
    for bitstream in pdfs:
        bitstream_metadata = metadata_map(bitstream.get("metadata", []))
        rights_values = values(bitstream_metadata, "dc.rights.uri") + values(metadata, "dc.rights.uri")
        allowed = find_allowed_rights(rights_values)
        if not allowed:
            continue
        rights_uri, rights_code = allowed
        retrieve = bitstream.get("retrieveLink") or bitstream.get("downloadLink")
        if not retrieve:
            continue
        base = endpoint.split("/rest/", 1)[0] + "/"
        download_url = str(retrieve) if str(retrieve).startswith("http") else urljoin(base, str(retrieve).lstrip("/"))
        title = first(metadata, "dc.title") or str(item.get("name", "")).strip()
        if not title:
            continue
        doi = first(metadata, "dc.identifier.doi", "oapen.identifier.doi")
        isbns = unique(values(metadata, "dc.identifier.isbn", "oapen.identifier.isbn")
                       + [value for value in values(metadata, "dc.identifier") if "isbn" in value.casefold()])
        publishers = values(metadata, "dc.publisher", "publisher.name")
        subjects = unique(values(metadata, "dc.subject") + values(metadata, "dc.subject.other"))
        item_id = stable_id("oapen", doi, isbns[0] if isbns else "", title, publishers[0] if publishers else "")
        return {
            "id": item_id,
            "source": "oapen",
            "sourceId": str(item.get("uuid") or item.get("handle") or item.get("id") or ""),
            "title": title,
            "authors": values(metadata, "dc.contributor.author", "dc.creator"),
            "publisher": publishers[0] if publishers else "",
            "subjects": subjects,
            "language": first(metadata, "dc.language.iso", "dc.language") or "eng",
            "publicationType": "book",
            "doi": doi,
            "isbns": isbns,
            "downloadUrl": download_url,
            "rightsUri": rights_uri,
            "rightsCode": rights_code,
            "rightsEvidence": "Exact dc.rights.uri on the OAPEN item or ORIGINAL PDF bitstream",
            "catalogedAt": utc_now(),
        }
    return None


def download_and_validate(candidates: list[dict[str, Any]], data_dir: Path, workers: int = 4) -> list[dict[str, Any]]:
    data_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        future_map = {executor.submit(download_one, candidate, data_dir): candidate for candidate in candidates}
        for completed, future in enumerate(as_completed(future_map), 1):
            try:
                value = future.result()
                if value:
                    results.append(value)
                    print(f"Download: {len(results)} accepted, {completed}/{len(future_map)} checked")
            except Exception as error:
                candidate = future_map[future]
                print(f"Rejected {candidate['id']}: {error}")
    return sorted(results, key=lambda item: item["id"])


def download_one(candidate: dict[str, Any], data_dir: Path) -> dict[str, Any] | None:
    destination = data_dir / f"{candidate['id']}.pdf"
    if not destination.exists():
        request = Request(candidate["downloadUrl"], headers={"User-Agent": USER_AGENT, "Accept": "application/pdf"})
        with urlopen(request, timeout=180) as response, tempfile.NamedTemporaryFile(dir=data_dir, delete=False) as temporary:
            shutil.copyfileobj(response, temporary)
            temporary_path = Path(temporary.name)
        try:
            if temporary_path.stat().st_size < 1024 or temporary_path.read_bytes()[:5] != b"%PDF-":
                raise ValueError("download was not a PDF")
            os.replace(temporary_path, destination)
        finally:
            temporary_path.unlink(missing_ok=True)
    validation = validate_born_digital_pdf(destination)
    if not validation["bornDigital"]:
        destination.unlink(missing_ok=True)
        raise ValueError(validation["reason"])
    return {
        **candidate,
        "sha256": sha256_file(destination),
        "bytes": destination.stat().st_size,
        "pageCount": validation["pageCount"],
        "pageTier": page_tier(validation["pageCount"]),
        "hasOutline": validation["hasOutline"],
        "textPageRatio": validation["textPageRatio"],
        "downloadedAt": utc_now(),
        "localPath": str(destination.relative_to(data_dir.parent.parent)),
    }


def validate_born_digital_pdf(path: Path) -> dict[str, Any]:
    try:
        from pypdf import PdfReader
    except ImportError as error:
        raise RuntimeError("pypdf is required; install requirements-corpus.txt") from error
    reader = PdfReader(path)
    if reader.is_encrypted:
        return {"bornDigital": False, "reason": "encrypted PDF", "pageCount": len(reader.pages), "hasOutline": False, "textPageRatio": 0}
    count = len(reader.pages)
    if count == 0:
        return {"bornDigital": False, "reason": "zero-page PDF", "pageCount": 0, "hasOutline": False, "textPageRatio": 0}
    indices = sorted(set(round(index * (count - 1) / max(1, min(11, count) - 1)) for index in range(min(11, count))))
    text_pages = 0
    characters = 0
    for index in indices:
        text = reader.pages[index].extract_text() or ""
        visible = len(re.sub(r"\s+", "", text))
        characters += visible
        if visible >= 50:
            text_pages += 1
    ratio = text_pages / len(indices)
    born_digital = ratio >= 0.7 and characters / len(indices) >= 100
    try:
        outline = bool(reader.outline)
    except Exception:
        outline = False
    return {
        "bornDigital": born_digital,
        "reason": "insufficient selectable text coverage" if not born_digital else "validated selectable text",
        "pageCount": count,
        "hasOutline": outline,
        "textPageRatio": round(ratio, 4),
    }


def stratified_sample(items: list[dict[str, Any]], target: int) -> list[dict[str, Any]]:
    remaining = sorted(items, key=lambda item: item["id"])
    selected: list[dict[str, Any]] = []
    publishers: set[str] = set()
    subjects: set[str] = set()
    tiers: dict[str, int] = {"short": 0, "medium": 0, "long": 0}
    outline_counts = {True: 0, False: 0}
    while remaining and len(selected) < target:
        def score(item: dict[str, Any]) -> tuple[float, str]:
            publisher = normalize_key(item.get("publisher", ""))
            subject_values = {normalize_key(value) for value in item.get("subjects", []) if value}
            novelty = (4 if publisher and publisher not in publishers else 0) + min(4, len(subject_values - subjects))
            tier = item.get("pageTier", "medium")
            balance = 2 / (1 + tiers.get(tier, 0)) + 1 / (1 + outline_counts[bool(item.get("hasOutline"))])
            return novelty + balance, item["id"]
        chosen = max(remaining, key=score)
        remaining.remove(chosen)
        selected.append(chosen)
        publisher = normalize_key(chosen.get("publisher", ""))
        if publisher:
            publishers.add(publisher)
        subjects.update(normalize_key(value) for value in chosen.get("subjects", []) if value)
        tiers[chosen.get("pageTier", "medium")] = tiers.get(chosen.get("pageTier", "medium"), 0) + 1
        outline_counts[bool(chosen.get("hasOutline"))] += 1
    return selected


def dedupe_metadata(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        keys = [
            f"doi:{normalize_key(item.get('doi', ''))}" if item.get("doi") else "",
            *[f"isbn:{re.sub(r'[^0-9X]', '', isbn.upper())}" for isbn in item.get("isbns", [])],
            f"title:{normalize_key(item['title'])}|publisher:{normalize_key(item.get('publisher', ''))}",
        ]
        nonempty = [key for key in keys if key]
        if any(key in seen for key in nonempty):
            continue
        seen.update(nonempty)
        result.append(item)
    return result


def dedupe_checksum(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        if item["sha256"] in seen:
            continue
        seen.add(item["sha256"])
        result.append(item)
    return result


def page_tier(page_count: int) -> str:
    if page_count < 150:
        return "short"
    if page_count <= 350:
        return "medium"
    return "long"


def metadata_map(raw: Any) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    if isinstance(raw, dict):
        for key, value in raw.items():
            values_list = value if isinstance(value, list) else [value]
            result[str(key)] = [str(item.get("value", "") if isinstance(item, dict) else item).strip() for item in values_list]
        return result
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        key = str(entry.get("key") or entry.get("element") or "")
        value = str(entry.get("value") or "").strip()
        if key and value:
            result.setdefault(key, []).append(value)
    return result


def values(metadata: dict[str, list[str]], *prefixes: str) -> list[str]:
    result: list[str] = []
    for key, entries in metadata.items():
        if any(key == prefix or key.startswith(prefix + ".") for prefix in prefixes):
            result.extend(entries)
    return unique(result)


def first(metadata: dict[str, list[str]], *prefixes: str) -> str:
    found = values(metadata, *prefixes)
    return found[0] if found else ""
