from __future__ import annotations

import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


def run_predictions(extracted_dir: Path, output_dir: Path, node: str = "node", workers: int = 4) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    runner = Path(__file__).resolve().parents[1] / "run_parser.cjs"

    def parse_one(extraction: Path) -> Path:
        output = output_dir / extraction.name
        subprocess.run([node, str(runner), str(extraction), str(output)], check=True, timeout=600)
        return output

    extractions = sorted(extracted_dir.glob("*.json"))
    outputs: list[Path] = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {executor.submit(parse_one, extraction): extraction for extraction in extractions}
        failures: list[str] = []
        for completed, future in enumerate(as_completed(futures), 1):
            source = futures[future]
            try:
                outputs.append(future.result())
                print(f"[{completed}/{len(futures)}] parsed {source.name}")
            except Exception as error:
                print(f"[{completed}/{len(futures)}] failed {source.name}: {error}")
                failures.append(source.name)
    if failures:
        raise RuntimeError(f"Parsing failed for {len(failures)} documents: {', '.join(failures[:8])}")
    return sorted(outputs)
