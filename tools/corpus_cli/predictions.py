from __future__ import annotations

import subprocess
from pathlib import Path


def run_predictions(extracted_dir: Path, output_dir: Path, node: str = "node") -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    runner = Path(__file__).resolve().parents[1] / "run_parser.cjs"
    outputs: list[Path] = []
    for extraction in sorted(extracted_dir.glob("*.json")):
        output = output_dir / extraction.name
        subprocess.run([node, str(runner), str(extraction), str(output)], check=True)
        outputs.append(output)
    return outputs
