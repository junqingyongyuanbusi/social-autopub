"""WikiFX article-content sidecar for social-autopub."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware

from app import config, db
from app.articles.router import router as articles_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    db.init_db()
    yield


app = FastAPI(
    title="WikiFX Article Content",
    description=(
        "Internal WikiFX article fetch/extraction service. "
        "The NestJS API is the only supported caller."
    ),
    version=config.SERVICE_VERSION,
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.include_router(articles_router)


def _health_payload() -> dict:
    # Import checks stay lazy so a missing optional dependency produces a useful
    # health response rather than preventing the app from exposing diagnostics.
    try:
        with db.get_conn() as conn:
            conn.execute("SELECT 1").fetchone()
        storage_ok = True
    except Exception:
        storage_ok = False
    try:
        import lxml  # noqa: F401

        lxml_ok = True
    except ImportError:
        lxml_ok = False
    try:
        import curl_cffi  # noqa: F401

        curl_cffi_ok = True
    except ImportError:
        curl_cffi_ok = False
    return {
        "ok": bool(
            config.CONTENT_API_KEY and storage_ok and lxml_ok and curl_cffi_ok
        ),
        "version": config.SERVICE_VERSION,
        "storage": "ok" if storage_ok else "error",
        "dependencies": {"lxml": lxml_ok, "curl_cffi": curl_cffi_ok},
        "content_api_key_configured": bool(config.CONTENT_API_KEY),
    }


@app.get("/api/health")
@app.get("/healthz")
def health():
    payload = _health_payload()
    if not payload["ok"]:
        raise HTTPException(status_code=503, detail=payload)
    return payload
