from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit


ALLOWED_RIGHTS = {
    "https://creativecommons.org/publicdomain/mark/1.0/": "PDM-1.0",
    "https://creativecommons.org/publicdomain/zero/1.0/": "CC0-1.0",
    "https://creativecommons.org/licenses/by/3.0/": "CC-BY-3.0",
    "https://creativecommons.org/licenses/by/4.0/": "CC-BY-4.0",
}


def canonical_rights_uri(value: str) -> str | None:
    raw = value.strip()
    if not raw:
        return None
    parsed = urlsplit(raw)
    if parsed.netloc.casefold() not in {"creativecommons.org", "www.creativecommons.org"}:
        return None
    path = parsed.path.rstrip("/")
    if path.casefold().endswith("/legalcode"):
        path = path[: -len("/legalcode")]
    path = path.rstrip("/") + "/"
    canonical = urlunsplit(("https", "creativecommons.org", path.casefold(), "", ""))
    return canonical if canonical in ALLOWED_RIGHTS else None


def license_code(value: str) -> str | None:
    canonical = canonical_rights_uri(value)
    return ALLOWED_RIGHTS.get(canonical) if canonical else None


def find_allowed_rights(values: list[str]) -> tuple[str, str] | None:
    for value in values:
        canonical = canonical_rights_uri(value)
        if canonical:
            return canonical, ALLOWED_RIGHTS[canonical]
    return None
