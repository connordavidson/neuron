from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any

from .common import load_json


def write_report(evaluation_path: Path, html_path: Path) -> Path:
    result = load_json(evaluation_path)
    html_path.parent.mkdir(parents=True, exist_ok=True)
    cards = "".join(metric_card(name, gate) for name, gate in result.get("gates", {}).items())
    status = "PASS" if result.get("promotionAllowed") else "NOT READY"
    document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neuron parser scorecard</title><style>
:root{{--paper:#f7f4ee;--ink:#211f27;--muted:#6e6977;--pass:#176b45;--fail:#a52b35;--card:#fff}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}}
main{{max-width:1100px;margin:auto;padding:48px 24px}}header{{display:flex;justify-content:space-between;gap:24px;align-items:end}}
h1{{font:700 38px/1.05 Georgia,serif;margin:0}}.meta{{color:var(--muted)}}.status{{font-weight:800;letter-spacing:.08em}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:30px}}.card{{background:var(--card);border-radius:18px;padding:18px;box-shadow:0 7px 22px #352d4912}}
.card h2{{font-size:13px;margin:0 0 14px;color:var(--muted)}}.value{{font:700 30px/1 Georgia,serif}}.pass{{color:var(--pass)}}.fail{{color:var(--fail)}}
.bar{{height:7px;background:#e8e3ec;border-radius:9px;margin-top:14px;overflow:hidden}}.fill{{height:100%;background:currentColor}}
pre{{margin-top:28px;background:#24212a;color:#f8f3ff;border-radius:16px;padding:18px;overflow:auto;font-size:12px}}
</style></head><body><main><header><div><h1>Parser reliability</h1><div class="meta">{html.escape(result.get('split', 'unknown'))} · {result.get('scoredBooks', 0)} / {result.get('expectedBooks', 0)} books scored</div></div>
<div class="status {'pass' if result.get('promotionAllowed') else 'fail'}">{status}</div></header><section class="grid">{cards}</section>
<pre>{html.escape(json.dumps(result.get('metrics', {}), indent=2, sort_keys=True))}</pre></main></body></html>"""
    html_path.write_text(document, encoding="utf-8")
    return html_path


def metric_card(name: str, gate: dict[str, Any]) -> str:
    value = gate.get("actual")
    target = gate.get("target")
    passed = bool(gate.get("passed"))
    displayed = "n/a" if value is None else f"{float(value) * 100:.2f}%"
    target_label = f"{gate.get('operator')} {float(target) * 100:.2f}%"
    width = 0 if value is None else max(0, min(100, float(value) * 100))
    return (f'<article class="card {"pass" if passed else "fail"}"><h2>{html.escape(split_name(name))}</h2>'
            f'<div class="value">{displayed}</div><div class="meta">Target {html.escape(target_label)}</div>'
            f'<div class="bar"><div class="fill" style="width:{width:.2f}%"></div></div></article>')


def split_name(value: str) -> str:
    result = []
    for character in value:
        if character.isupper() and result:
            result.append(" ")
        result.append(character)
    return "".join(result).capitalize()
