"""Internal HTTP contract for WikiFX article content.

The endpoint shapes intentionally match the Go scaffold's article-content
sidecar.  Only validated WikiFX article keys are accepted; callers cannot pass
an arbitrary URL to the fetcher.
"""

from __future__ import annotations

import hmac
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from app import config, db
from app.articles.content_policy import should_fetch
from app.articles.content_runner import fetch_article_row
from app.articles.extract import ContentDependencyMissing
from app.articles.fetcher import ArticleFetcher
from app.articles.models import (
    ArticleContentDetail,
    ArticleContentIndexBody,
    ArticleContentIndexResponse,
    ArticleContentRecordsResponse,
    ArticleContentResolveBody,
    ArticleContentResolved,
    ArticleContentResolveResponse,
)

MAX_INDEX_ITEMS = 1000
MAX_RESOLVE_ITEMS = 400
MAX_RESOLVE_WORKERS = 6

_ARTICLE_LANG = re.compile(r"^[a-z]{2,8}(?:-[a-z]{2,8})?$")
_ARTICLE_ID = re.compile(r"^[0-9]{8,32}$")
_OFFICIAL_HOSTS = frozenset({"www.wikifx.com", "aws-www.wikifx.com"})

# A single forced fetch is an operator action.  Serializing it prevents a
# double-click from issuing two simultaneous requests to Akamai.
_single_fetch_lock = threading.Lock()
_resolve_lock = threading.Lock()


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def require_content_api_key(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> None:
    """Authenticate the NestJS-to-sidecar hop without exposing the key."""
    expected = config.CONTENT_API_KEY.strip()
    if not expected:
        raise _error(
            503,
            "content_api_not_configured",
            "Article content service is not configured",
        )
    prefix = "Bearer "
    supplied = (
        authorization[len(prefix) :].strip()
        if authorization and authorization.startswith(prefix)
        else ""
    )
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise _error(401, "content_api_unauthorized", "Invalid article content credentials")


router = APIRouter(
    prefix="/api/articles",
    tags=["articles"],
    dependencies=[Depends(require_content_api_key)],
)


def _normalize_key(language: str, article_id: str) -> tuple[str, str]:
    normalized_language = language.strip().lower()
    normalized_id = article_id.strip()
    if not _ARTICLE_LANG.fullmatch(normalized_language) or not _ARTICLE_ID.fullmatch(
        normalized_id
    ):
        raise _error(422, "invalid_article_key", "language or article_id is malformed")
    return normalized_language, normalized_id


def _validate_article_url(
    language: str, article_id: str, article_url: str
) -> str:
    """Validate that a supplied URL names exactly the requested article."""
    try:
        parts = urlsplit(article_url.strip())
        port = parts.port
    except ValueError:
        raise _error(422, "invalid_article_url", "article_url is malformed") from None

    expected_path = (
        rf"/{re.escape(language)}/newsdetail/{re.escape(article_id)}\.html?"
    )
    if (
        parts.scheme not in {"http", "https"}
        or (parts.hostname or "").lower() not in _OFFICIAL_HOSTS
        or port is not None
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
        or re.fullmatch(expected_path, parts.path) is None
    ):
        raise _error(
            422,
            "invalid_article_url",
            "article_url must match the requested WikiFX article",
        )
    return article_url.strip()


def _canonical_candidates(language: str, article_id: str) -> list[str]:
    if config.WIKIFX_ARTICLE_SCHEME not in {"http", "https"}:
        raise _error(
            503,
            "content_fetch_unavailable",
            "Article content fetching is unavailable",
        )
    base = f"{config.WIKIFX_ARTICLE_SCHEME}://www.wikifx.com/{language}/newsdetail/{article_id}"
    return [f"{base}.html", f"{base}.htm"]


def _detail_or_404(language: str, article_id: str) -> dict:
    row = db.get_article_content(language, article_id)
    if row is None:
        raise _error(404, "content_not_fetched", "Article content has not been fetched")
    return row


def _fetch_with_extension_fallback(
    fetcher: ArticleFetcher, target: tuple[str, str, str]
) -> dict:
    """Try the alternate WikiFX article suffix after a confirmed 404."""
    language, article_id, supplied_url = target
    row = fetch_article_row(fetcher, target)
    if row.get("status") != "not_found":
        return row

    # The ranking payload has historically contained both .html and .htm
    # links.  Keep the supplied URL first, then try the fixed official forms;
    # ArticleFetcher itself handles the www/aws-www host fallback.
    for candidate in _canonical_candidates(language, article_id):
        if candidate == supplied_url:
            continue
        row = fetch_article_row(fetcher, (language, article_id, candidate))
        if row.get("status") != "not_found":
            break
    return row


# Fixed paths must be declared before /content/{language}/{article_id}; otherwise
# a framework upgrade could make "index" or "records" look like a language.
@router.post("/content/index", response_model=ArticleContentIndexResponse)
def content_index(body: ArticleContentIndexBody) -> ArticleContentIndexResponse:
    if len(body.items) > MAX_INDEX_ITEMS:
        raise _error(422, "too_many_items", f"At most {MAX_INDEX_ITEMS} items are allowed")
    keys = [_normalize_key(item.language, item.article_id) for item in body.items]
    return ArticleContentIndexResponse(items=db.list_article_content_index(keys))


@router.get("/content/records", response_model=ArticleContentRecordsResponse)
def content_records(
    published_start: date | None = Query(default=None),
    published_end: date | None = Query(default=None),
    language: str | None = Query(default=None, max_length=16),
    status: Literal[
        "ok", "empty", "not_found", "blocked", "timeout", "error"
    ]
    | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> ArticleContentRecordsResponse:
    normalized_language = language.strip().lower() if language else None
    if normalized_language and not _ARTICLE_LANG.fullmatch(normalized_language):
        raise _error(422, "invalid_language", "language is malformed")
    if published_start and published_end and published_start > published_end:
        raise _error(
            422,
            "invalid_published_range",
            "published_start must not be later than published_end",
        )
    result = db.list_article_content_records(
        page=page,
        page_size=page_size,
        published_start=published_start.isoformat() if published_start else None,
        published_end=published_end.isoformat() if published_end else None,
        language=normalized_language,
        status=status,
    )
    return ArticleContentRecordsResponse(**result)


@router.post("/content/resolve", response_model=ArticleContentResolveResponse)
def resolve_article_contents(
    body: ArticleContentResolveBody,
) -> ArticleContentResolveResponse:
    """Return cached bodies and synchronously fetch missing bodies.

    This is the same contract used by the Go public proxy when it enriches a
    ranked topic response.  The lock makes concurrent topic requests share one
    fetch pass instead of duplicating upstream traffic.
    """
    if len(body.items) > MAX_RESOLVE_ITEMS:
        raise _error(422, "too_many_items", f"At most {MAX_RESOLVE_ITEMS} items are allowed")

    targets = []
    for item in body.items:
        language, article_id = _normalize_key(item.language, item.article_id)
        article_url = _validate_article_url(language, article_id, item.article_url)
        targets.append((language, article_id, article_url))
    if not targets:
        return ArticleContentResolveResponse(items=[])

    # Keep first occurrence order while deduplicating the fetch work.
    unique_targets = []
    seen_keys = set()
    for target in targets:
        key = (target[0], target[1])
        if key in seen_keys:
            continue
        seen_keys.add(key)
        unique_targets.append(target)
    keys = [(language, article_id) for language, article_id, _ in unique_targets]

    with _resolve_lock:
        before_rows = db.list_article_contents(keys)
        before = {(row["language"], row["article_id"]): row for row in before_rows}
        states = db.get_article_content_states(keys)
        now = datetime.now(timezone.utc)
        pending = []
        for target in unique_targets:
            key = (target[0], target[1])
            existing = before.get(key) or {}
            state = states.get(key)
            # A successful row may still need its first-image probe.  All
            # failed rows, including confirmed 404s, go through the shared
            # cooldown/max-attempt policy; only POST /fetch bypasses it.
            needs_image_probe = bool(existing.get("content")) and not bool(
                existing.get("first_image_checked")
            )
            needs_body = not bool(existing.get("content"))
            if needs_image_probe and state and state.get("status") == "ok":
                pending.append(target)
            elif needs_body and state and state.get("status") == "ok":
                # Repair an inconsistent legacy row whose status says ok but
                # whose body is missing.
                pending.append(target)
            elif should_fetch(state, now=now):
                pending.append(target)

        if pending:
            fetcher = ArticleFetcher()
            try:
                with ThreadPoolExecutor(
                    max_workers=min(MAX_RESOLVE_WORKERS, len(pending))
                ) as pool:
                    fetched_rows = list(
                        pool.map(
                            lambda target: _fetch_with_extension_fallback(fetcher, target),
                            pending,
                        )
                    )
            except ContentDependencyMissing:
                raise _error(
                    503,
                    "content_fetch_unavailable",
                    "Article content fetching is unavailable",
                ) from None
            finally:
                fetcher.close()
            with db.get_conn() as conn:
                db.upsert_article_contents(conn, fetched_rows)

        after_rows = db.list_article_contents(keys)
        after = {(row["language"], row["article_id"]): row for row in after_rows}

    resolved = []
    for language, article_id, article_url in targets:
        key = (language, article_id)
        row = after.get(key) or {
            "language": language,
            "article_id": article_id,
            "url": article_url,
            "status": "error",
            "error_code": "fetch_error",
            "content": None,
        }
        has_content = bool(row.get("content")) and row.get("status") == "ok"
        if has_content:
            previous = before.get(key) or {}
            if previous.get("content"):
                content_status = "stored"
                if not previous.get("first_image_checked"):
                    if row.get("first_image_url"):
                        content_message = "正文已从数据库返回；首图已实时抓取、入库"
                    else:
                        content_message = "正文已从数据库返回；本次未获取到有效首图"
                else:
                    content_message = "正文和首图信息已从数据库返回"
            else:
                content_status = "fetched"
                content_message = "数据库中没有正文，已实时抓取、入库并返回"
        else:
            content_status = "fetch_failed"
            error_code = row.get("error_code") or row.get("status") or "unknown"
            if row.get("content"):
                content_message = f"最新抓取失败，已保留历史正文（{error_code}）"
            else:
                content_message = f"数据库中没有正文，实时抓取失败（{error_code}）"
        resolved.append(
            ArticleContentResolved(
                **row,
                content_status=content_status,
                content_message=content_message,
            )
        )
    return ArticleContentResolveResponse(items=resolved)


@router.get("/content/{language}/{article_id}", response_model=ArticleContentDetail)
def read_article_content(language: str, article_id: str) -> ArticleContentDetail:
    language, article_id = _normalize_key(language, article_id)
    return ArticleContentDetail(**_detail_or_404(language, article_id))


@router.post(
    "/content/{language}/{article_id}/fetch", response_model=ArticleContentDetail
)
def fetch_single_content(language: str, article_id: str) -> ArticleContentDetail:
    """Force-fetch one article and return its structured latest status."""
    language, article_id = _normalize_key(language, article_id)
    existing = db.get_article_content(language, article_id)
    stored_url = (existing or {}).get("url")

    candidates: list[str]
    canonical_candidates = _canonical_candidates(language, article_id)
    if stored_url:
        try:
            stored_candidate = _validate_article_url(language, article_id, stored_url)
            # Prefer the URL that previously worked, but retain the alternate
            # extension/host candidates so a transient 404 can self-heal.
            candidates = [
                stored_candidate,
                *[candidate for candidate in canonical_candidates if candidate != stored_candidate],
            ]
        except HTTPException:
            # A legacy row may contain a URL written before URL validation was
            # introduced.  Never replay it; use the fixed official candidates.
            candidates = canonical_candidates
    else:
        candidates = canonical_candidates

    fetcher = ArticleFetcher()
    try:
        with _single_fetch_lock:
            row = None
            for url in candidates:
                row = fetch_article_row(fetcher, (language, article_id, url))
                if row.get("status") != "not_found":
                    break
    except ContentDependencyMissing:
        raise _error(
            503,
            "content_fetch_unavailable",
            "Article content fetching is unavailable",
        ) from None
    finally:
        fetcher.close()

    if row is None:  # defensive; the candidate list is never empty
        raise _error(503, "content_fetch_unavailable", "Article content fetching is unavailable")
    with db.get_conn() as conn:
        db.upsert_article_contents(conn, [row])
    stored = db.get_article_content(language, article_id)
    if stored is None:
        raise _error(500, "content_persist_failed", "Article content result could not be stored")
    return ArticleContentDetail(**stored)
