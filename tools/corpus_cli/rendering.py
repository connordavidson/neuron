from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def render_pdf(pdf_path: Path, output_dir: Path, dpi: int = 120, first_page: int | None = None, last_page: int | None = None) -> list[Path]:
    executable = shutil.which("pdftoppm")
    if not executable:
        raise RuntimeError("pdftoppm is required to render PDF pages")
    output_dir.mkdir(parents=True, exist_ok=True)
    prefix = output_dir / pdf_path.stem
    command = [executable, "-png", "-r", str(dpi)]
    if first_page is not None:
        command.extend(["-f", str(first_page + 1)])
    if last_page is not None:
        command.extend(["-l", str(last_page + 1)])
    command.extend([str(pdf_path), str(prefix)])
    completed = subprocess.run(command, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if completed.returncode:
        raise RuntimeError(completed.stderr.strip() or f"pdftoppm exited with {completed.returncode}")
    return sorted(output_dir.glob(f"{pdf_path.stem}-*.png"))
