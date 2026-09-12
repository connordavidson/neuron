from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import load_json, normalize_key, sha256_file, utc_now, write_json
from .controls import discover_controls, download_controls
from .licenses import canonical_rights_uri
from .oapen import dedupe_checksum, discover_oapen, download_and_validate, stratified_sample


def sync_corpus(config_path: Path, manifest_path: Path, refresh: bool = False, oapen_limit: int | None = None,
                control_limit: int | None = None, candidate_limit: int | None = None, workers: int = 4) -> dict[str, Any]:
    config = load_json(config_path)
    if manifest_path.exists() and not refresh:
        manifest = load_json(manifest_path)
        verify_manifest(manifest, manifest_path.parent)
        print(f"Verified frozen manifest with {len(manifest.get('items', []))} items. Use --refresh to rebuild it.")
        return manifest
    data_root = manifest_path.parent / "data"
    oapen_config = config["oapen"]
    target = oapen_limit if oapen_limit is not None else int(oapen_config["target"])
    controls_target = control_limit if control_limit is not None else int(config["standardEbooks"]["target"])
    candidates = discover_oapen(oapen_config, candidate_limit or max(target * 4, target + 50)) if target else []
    # OAPEN's result order can contain long runs from one publisher. Reorder the
    # complete metadata pool for publisher/subject novelty before any downloads
    # so an interrupted or smoke-sized sync is still structurally diverse.
    candidates = stratified_sample(candidates, len(candidates))
    validated: list[dict[str, Any]] = []
    batch_size = max(4, workers * 3)
    for offset in range(0, len(candidates), batch_size):
        validated.extend(download_and_validate(candidates[offset:offset + batch_size], data_root / "oapen", workers))
        validated = dedupe_checksum(validated)
        if len(validated) >= target:
            break
    oapen_items = stratified_sample(validated, target)
    if len(oapen_items) < target:
        raise RuntimeError(f"Only {len(oapen_items)} eligible born-digital OAPEN PDFs were validated; {target} required")
    assign_splits(oapen_items, oapen_config)
    if target == int(oapen_config["target"]):
        assert_stratification(oapen_items, oapen_config)

    control_candidates = discover_controls(config["standardEbooks"]["opdsFeed"], controls_target) if controls_target else []
    control_items = download_controls(control_candidates, data_root / "standardebooks")
    manifest = {
        "schemaVersion": 1,
        "frozenAt": utc_now(),
        "selection": {
            "language": config.get("language", "en"),
            "bornDigitalOnly": bool(config.get("bornDigitalOnly", True)),
            "allowedRightsUris": config["allowedRightsUris"],
            "oapen": {**oapen_config, "selected": len(oapen_items)},
            "standardEbooks": {**config["standardEbooks"], "selected": len(control_items)},
            "doubleReviewRule": "sha256(book id prefix) modulo 5 = 0 for development and locked-test",
        },
        "items": [*oapen_items, *control_items],
    }
    write_json(manifest_path, manifest)
    verify_manifest(manifest, manifest_path.parent)
    return manifest


def assign_splits(items: list[dict[str, Any]], config: dict[str, Any]) -> None:
    discovery = min(int(config.get("discovery", len(items))), len(items))
    development = min(int(config.get("development", 0)), max(0, len(items) - discovery))
    locked = min(int(config.get("lockedTest", 0)), max(0, len(items) - discovery - development))
    for index, item in enumerate(items):
        if index < discovery:
            split = "discovery"
        elif index < discovery + development:
            split = "development"
        elif index < discovery + development + locked:
            split = "locked-test"
        else:
            split = "discovery"
        item["split"] = split
        item["doubleReview"] = split in {"development", "locked-test"} and int(item["id"][:8], 16) % 5 == 0


def assert_stratification(items: list[dict[str, Any]], config: dict[str, Any]) -> None:
    publishers = {normalize_key(item.get("publisher", "")) for item in items if item.get("publisher")}
    subjects = {normalize_key(subject) for item in items for subject in item.get("subjects", []) if subject}
    if len(publishers) < int(config.get("minimumPublishers", 20)):
        raise RuntimeError(f"Corpus has only {len(publishers)} publishers")
    if len(subjects) < int(config.get("minimumSubjects", 10)):
        raise RuntimeError(f"Corpus has only {len(subjects)} subjects")
    tiers = {item.get("pageTier") for item in items}
    if not {"short", "medium", "long"}.issubset(tiers):
        raise RuntimeError("Corpus does not cover all page-count tiers")
    outline_values = {bool(item.get("hasOutline")) for item in items}
    if outline_values != {False, True}:
        raise RuntimeError("Corpus must contain PDFs both with and without outlines")


def verify_manifest(manifest: dict[str, Any], corpus_root: Path) -> None:
    seen_ids: set[str] = set()
    seen_checksums: set[str] = set()
    for item in manifest.get("items", []):
        if item["id"] in seen_ids:
            raise ValueError(f"Duplicate manifest id: {item['id']}")
        seen_ids.add(item["id"])
        rights = canonical_rights_uri(item.get("rightsUri", ""))
        if not rights:
            raise ValueError(f"Disallowed or unknown rights URI for {item['id']}")
        if item.get("rightsCode", "").upper().find("NC") >= 0 or item.get("rightsCode", "").upper().find("ND") >= 0 or item.get("rightsCode", "").upper().find("SA") >= 0:
            raise ValueError(f"Restrictive license code for {item['id']}")
        checksum = item.get("sha256", "")
        if checksum in seen_checksums:
            raise ValueError(f"Duplicate content checksum: {checksum}")
        seen_checksums.add(checksum)
        local = corpus_root / item.get("localPath", "")
        if not local.is_file():
            raise ValueError(f"Missing local source for {item['id']}: {local}")
        if sha256_file(local) != checksum:
            raise ValueError(f"Checksum mismatch for {item['id']}")
