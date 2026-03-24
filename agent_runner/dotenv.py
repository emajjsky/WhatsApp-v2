from __future__ import annotations

import os
from pathlib import Path


def _strip_quotes(value: str) -> str:
    trimmed = value.strip()
    if len(trimmed) >= 2 and ((trimmed[0] == trimmed[-1] == '"') or (trimmed[0] == trimmed[-1] == "'")):
        return trimmed[1:-1]
    return trimmed


def load_dotenv(path: str | None = None, override: bool = False) -> Path | None:
    """Load key=value pairs from a .env file into os.environ.

    - Never raises for missing files.
    - Does not override existing env vars by default.
    """

    candidates: list[Path] = []
    if path:
        candidates = [Path(path)]
    else:
        repo_root = Path(__file__).resolve().parent.parent
        candidates = [
            Path.cwd() / ".env",
            repo_root / ".env",
        ]

    for candidate in candidates:
        if not candidate.exists() or not candidate.is_file():
            continue

        for raw in candidate.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export ") :].strip()

            if "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip().lstrip("\ufeff")
            value = _strip_quotes(value)
            if not key:
                continue

            if not override and key in os.environ:
                continue

            os.environ[key] = value

        return candidate

    return None

