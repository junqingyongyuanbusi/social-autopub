"""Configuration for the WikiFX article-content sidecar.

The sidecar deliberately owns only the article-content database and fetcher.  It
is an internal service: the NestJS API is the only supported caller and must
send ``Authorization: Bearer <WIKIFX_CONTENT_API_KEY>``.
"""

from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent


def _path_from_env(name: str, default: Path) -> Path:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    path = Path(raw).expanduser()
    return path if path.is_absolute() else BASE_DIR / path


# Mount a Railway/Docker volume at /app/data.  Keeping the SQLite database in
# this directory makes the content cache survive sidecar redeploys.
DATA_DIR = _path_from_env("WIKIFX_CONTENT_DATA_DIR", BASE_DIR / "data")
DB_PATH = _path_from_env("WIKIFX_CONTENT_DB_PATH", DATA_DIR / "wikifx.db")
IMAGES_DIR = DATA_DIR / "images"

# The fetcher never accepts a caller-provided arbitrary URL.  It reconstructs
# this fixed WikiFX article URL from a validated language/article_id pair and
# only falls back between the two official WikiFX hosts.
WIKIFX_ORIGIN = "https://www.wikifx.com"
WIKIFX_ARTICLE_SCHEME = (
    os.getenv("WIKIFX_ARTICLE_SCHEME", "https").strip().lower()
)

CONTENT_API_KEY = os.getenv("WIKIFX_CONTENT_API_KEY", "").strip()
SERVICE_VERSION = "1.0.0"

# PORT is injected by Railway.  API_PORT remains useful for local Docker and
# direct uvicorn invocations.
API_HOST = os.getenv("API_HOST", "0.0.0.0").strip() or "0.0.0.0"
API_PORT = int(os.getenv("PORT") or os.getenv("API_PORT", "8000"))
