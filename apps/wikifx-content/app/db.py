"""SQLite persistence for WikiFX article content.

This is intentionally a small, sidecar-owned database.  The NestJS service
keeps product state in Postgres; this database keeps the expensive WikiFX HTML
extraction result and its structured fetch status close to the fetcher.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional

from app import config


def _connect() -> sqlite3.Connection:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(config.DB_PATH), check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA cache_size = -64000")
    return conn


@contextmanager
def get_conn():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Create the article cache and apply additive migrations."""
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS article_contents (
                language TEXT NOT NULL,
                article_id TEXT NOT NULL,
                url TEXT,
                title TEXT,
                summary TEXT,
                first_image_url TEXT,
                first_image_checked INTEGER NOT NULL DEFAULT 0,
                content TEXT,
                content_chars INTEGER,
                published_date TEXT,
                published_date_source TEXT,
                extract_method TEXT,
                status TEXT NOT NULL,
                http_status INTEGER,
                error_code TEXT,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                first_fetched_at TEXT,
                fetched_at TEXT,
                succeeded_at TEXT,
                PRIMARY KEY (language, article_id)
            );

            CREATE INDEX IF NOT EXISTS idx_article_contents_status
                ON article_contents(status, fetched_at);
            CREATE INDEX IF NOT EXISTS idx_article_contents_lang
                ON article_contents(language, succeeded_at DESC);
            CREATE INDEX IF NOT EXISTS idx_article_contents_published
                ON article_contents(published_date DESC, language, status);
            """
        )

        # Databases created by the first sidecar release may not have these
        # columns.  SQLite has no portable ADD COLUMN IF NOT EXISTS, so inspect
        # PRAGMA before each additive migration.
        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(article_contents)")
        }
        if "summary" not in columns:
            conn.execute("ALTER TABLE article_contents ADD COLUMN summary TEXT")
        if "first_image_url" not in columns:
            conn.execute(
                "ALTER TABLE article_contents ADD COLUMN first_image_url TEXT"
            )
        if "first_image_checked" not in columns:
            conn.execute(
                "ALTER TABLE article_contents ADD COLUMN "
                "first_image_checked INTEGER NOT NULL DEFAULT 0"
            )


def _dumps(obj: Any) -> Optional[str]:
    if obj is None:
        return None
    return json.dumps(obj, ensure_ascii=False)


def _loads(value: Optional[str], default=None):
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


# The index deliberately omits the large content column.  ``first_image_checked``
# is an internal bookkeeping bit and is filtered by the Pydantic response model.
_ARTICLE_KEY_CHUNK = 400
_ARTICLE_INDEX_COLUMNS = (
    "language, article_id, url, title, summary, first_image_url, "
    "first_image_checked, content_chars, published_date, "
    "published_date_source, extract_method, status, http_status, error_code, "
    "attempt_count, first_fetched_at, fetched_at, succeeded_at"
)


def upsert_article_contents(
    conn: sqlite3.Connection, rows: List[Dict[str, Any]]
) -> None:
    """Persist fetch attempts without erasing a previously good article.

    A transient 404/blocked response updates the latest status, but only a
    successful extraction is allowed to replace title/summary/content fields.
    This preserves the last known body for diagnostics while callers can still
    make decisions from the structured status.
    """
    if not rows:
        return

    payload = []
    for row in rows:
        fetched_at = row.get("fetched_at") or now_iso()
        payload.append(
            (
                row["language"],
                row["article_id"],
                row.get("url"),
                row.get("title"),
                row.get("summary"),
                row.get("first_image_url"),
                1 if row.get("first_image_checked") else 0,
                row.get("content"),
                row.get("content_chars"),
                row.get("published_date"),
                row.get("published_date_source"),
                row.get("extract_method"),
                row.get("status", "error"),
                row.get("http_status"),
                row.get("error_code"),
                fetched_at,
                fetched_at,
                row.get("succeeded_at"),
            )
        )

    conn.executemany(
        """
        INSERT INTO article_contents (
            language, article_id, url, title, summary,
            first_image_url, first_image_checked, content, content_chars,
            published_date, published_date_source, extract_method,
            status, http_status, error_code,
            attempt_count, first_fetched_at, fetched_at, succeeded_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)
        ON CONFLICT(language, article_id) DO UPDATE SET
            url=excluded.url,
            title=CASE WHEN excluded.status='ok'
                THEN excluded.title ELSE article_contents.title END,
            summary=CASE WHEN excluded.status='ok'
                THEN excluded.summary ELSE article_contents.summary END,
            first_image_url=CASE WHEN excluded.status IN ('ok','empty')
                THEN excluded.first_image_url
                ELSE article_contents.first_image_url END,
            first_image_checked=CASE WHEN excluded.first_image_checked=1
                THEN 1 ELSE article_contents.first_image_checked END,
            content=CASE WHEN excluded.status='ok'
                THEN excluded.content ELSE article_contents.content END,
            content_chars=CASE WHEN excluded.status='ok'
                THEN excluded.content_chars ELSE article_contents.content_chars END,
            published_date=CASE WHEN excluded.status='ok'
                THEN excluded.published_date ELSE article_contents.published_date END,
            published_date_source=CASE WHEN excluded.status='ok'
                THEN excluded.published_date_source
                ELSE article_contents.published_date_source END,
            extract_method=CASE WHEN excluded.status='ok'
                THEN excluded.extract_method ELSE article_contents.extract_method END,
            status=excluded.status,
            http_status=excluded.http_status,
            error_code=excluded.error_code,
            attempt_count=article_contents.attempt_count + 1,
            first_fetched_at=COALESCE(
                article_contents.first_fetched_at, excluded.first_fetched_at
            ),
            fetched_at=excluded.fetched_at,
            succeeded_at=COALESCE(excluded.succeeded_at, article_contents.succeeded_at)
        """,
        payload,
    )


def _query_article_keys(
    conn: sqlite3.Connection, keys: List[tuple], columns: str
) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for start in range(0, len(keys), _ARTICLE_KEY_CHUNK):
        chunk = keys[start : start + _ARTICLE_KEY_CHUNK]
        placeholders = ",".join("(?,?)" for _ in chunk)
        params: List[Any] = []
        for language, article_id in chunk:
            params.extend([language, article_id])
        rows = conn.execute(
            f"SELECT {columns} FROM article_contents "
            f"WHERE (language, article_id) IN (VALUES {placeholders})",
            params,
        ).fetchall()
        result.extend(dict(row) for row in rows)
    return result


def get_article_content_states(
    keys: List[tuple], conn: Optional[sqlite3.Connection] = None
) -> Dict[tuple, Dict[str, Any]]:
    if not keys:
        return {}

    def query(connection: sqlite3.Connection) -> Dict[tuple, Dict[str, Any]]:
        rows = _query_article_keys(
            connection,
            keys,
            "language, article_id, status, attempt_count, fetched_at, succeeded_at",
        )
        return {(row["language"], row["article_id"]): row for row in rows}

    if conn is not None:
        return query(conn)
    with get_conn() as connection:
        return query(connection)


def list_article_content_index(
    keys: List[tuple], conn: Optional[sqlite3.Connection] = None
) -> List[Dict[str, Any]]:
    if not keys:
        return []

    def query(connection: sqlite3.Connection) -> List[Dict[str, Any]]:
        return _query_article_keys(connection, keys, _ARTICLE_INDEX_COLUMNS)

    if conn is not None:
        return query(conn)
    with get_conn() as connection:
        return query(connection)


def list_article_contents(
    keys: List[tuple], conn: Optional[sqlite3.Connection] = None
) -> List[Dict[str, Any]]:
    if not keys:
        return []

    def query(connection: sqlite3.Connection) -> List[Dict[str, Any]]:
        return _query_article_keys(
            connection, keys, f"{_ARTICLE_INDEX_COLUMNS}, content"
        )

    if conn is not None:
        return query(conn)
    with get_conn() as connection:
        return query(connection)


def get_article_content(
    language: str,
    article_id: str,
    conn: Optional[sqlite3.Connection] = None,
) -> Optional[Dict[str, Any]]:
    def query(connection: sqlite3.Connection) -> Optional[Dict[str, Any]]:
        row = connection.execute(
            f"SELECT {_ARTICLE_INDEX_COLUMNS}, content FROM article_contents "
            "WHERE language = ? AND article_id = ?",
            (language, article_id),
        ).fetchone()
        return dict(row) if row else None

    if conn is not None:
        return query(conn)
    with get_conn() as connection:
        return query(connection)


def list_article_content_records(
    *,
    page: int = 1,
    page_size: int = 20,
    published_start: Optional[str] = None,
    published_end: Optional[str] = None,
    language: Optional[str] = None,
    status: Optional[str] = None,
    conn: Optional[sqlite3.Connection] = None,
) -> Dict[str, Any]:
    def query(connection: sqlite3.Connection) -> Dict[str, Any]:
        clauses: List[str] = []
        params: List[Any] = []
        if published_start:
            clauses.append("published_date >= ?")
            params.append(published_start)
        if published_end:
            clauses.append("published_date <= ?")
            params.append(published_end)
        if language:
            clauses.append("language = ?")
            params.append(language)
        if status:
            clauses.append("status = ?")
            params.append(status)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""

        summary_row = connection.execute(
            "SELECT "
            "COUNT(*) AS total, "
            "COALESCE(SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) AS ok, "
            "COALESCE(SUM(CASE WHEN status = 'empty' THEN 1 ELSE 0 END), 0) AS empty, "
            "COALESCE(SUM(CASE WHEN status = 'not_found' THEN 1 ELSE 0 END), 0) AS not_found, "
            "COALESCE(SUM(CASE WHEN status IN ('blocked','timeout','error') "
            "THEN 1 ELSE 0 END), 0) AS failed, "
            "COALESCE(SUM(content_chars), 0) AS total_content_chars, "
            "MAX(fetched_at) AS latest_fetched_at "
            f"FROM article_contents{where}",
            params,
        ).fetchone()
        summary = dict(summary_row)
        offset = (page - 1) * page_size
        rows = connection.execute(
            f"SELECT {_ARTICLE_INDEX_COLUMNS} FROM article_contents{where} "
            "ORDER BY COALESCE(fetched_at, first_fetched_at, '') DESC, "
            "language ASC, article_id ASC LIMIT ? OFFSET ?",
            [*params, page_size, offset],
        ).fetchall()
        language_rows = connection.execute(
            "SELECT DISTINCT language FROM article_contents "
            "WHERE language <> '' ORDER BY language"
        ).fetchall()
        return {
            "summary": summary,
            "items": [dict(row) for row in rows],
            "total": summary["total"],
            "page": page,
            "page_size": page_size,
            "languages": [row["language"] for row in language_rows],
        }

    if conn is not None:
        return query(conn)
    with get_conn() as connection:
        return query(connection)


def count_article_contents(
    conn: Optional[sqlite3.Connection] = None,
) -> Dict[str, int]:
    def query(connection: sqlite3.Connection) -> Dict[str, int]:
        rows = connection.execute(
            "SELECT status, COUNT(*) AS n FROM article_contents GROUP BY status"
        ).fetchall()
        counts = {row["status"]: row["n"] for row in rows}
        counts["total"] = sum(counts.values())
        return counts

    if conn is not None:
        return query(conn)
    with get_conn() as connection:
        return query(connection)


# Keep the helper names used by the scaffold's broader service import-compatible.
dumps = _dumps
loads = _loads
