"""正文批量抓取:后台单槽任务 + 进度快照.

为什么是后台任务而不是同步接口:一次完整抓取要先跑 GA 报表(27~54s)再抓
190 篇(≈116s),合计 145~170s,紧贴 Go 代理的 180s 超时、远超前端 120s。
而且这条链路上有 air 热重载和浏览器 idle 超时,长连接随时可能断,断了用户
也分不清任务是死是活。改成「POST 立即返回 + 轮询进度」后,两端的超时一行
都不用改。

同一时刻只允许一个任务(单槽)。第二个请求拿 409,手动触发和每日定时任务
因此天然互斥,不需要额外的锁文件。

断点续传靠两件事:每 chunk_size 篇提交一次(不是一个横跨两分钟的大事务),
以及重试策略里「ok 的不再抓」。所以进程被 kill 或服务器重启后重跑,已抓的
自动跳过,从断口继续。
"""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Tuple

from app import db
from app.articles.content_policy import (
    STATUS_EMPTY,
    STATUS_OK,
    should_fetch,
)
from app.articles.extract import ContentDependencyMissing, extract_article
from app.articles.fetcher import ArticleFetcher, ArticleFetchError

# (language, article_id, url)
Target = Tuple[str, str, str]
TargetResolver = Callable[[], List[Target]]

DEFAULT_MAX_WORKERS = 6
DEFAULT_CHUNK_SIZE = 20
# 连续这么多次被 Akamai 拦就中止整批。实测只跑过 30 篇无限流,190 篇是
# 6 倍暴露时长;宁可少抓,也不能把服务器 IP 撞进黑名单。
BLOCKED_CIRCUIT_LIMIT = 10

STATE_IDLE = "idle"
STATE_RESOLVING = "resolving"
STATE_FETCHING = "fetching"
STATE_FINISHED = "finished"
STATE_FAILED = "failed"
STATE_CANCELLED = "cancelled"
STATE_ABORTED_BLOCKED = "aborted_blocked"

TERMINAL_STATES = frozenset(
    {STATE_IDLE, STATE_FINISHED, STATE_FAILED, STATE_CANCELLED, STATE_ABORTED_BLOCKED}
)


class JobAlreadyRunning(RuntimeError):
    """已有任务在跑。"""


def fetch_article_row(fetcher: ArticleFetcher, target: Target) -> Dict:
    """抓单篇并翻译成 article_contents 行(批量与单篇抓取共用).

    除依赖缺失外永不向外抛——失败编码进 status/error_code,由调用方落库。
    """
    language, article_id, url = target
    now = db.now_iso()
    row = {
        "language": language,
        "article_id": article_id,
        "url": url,
        "fetched_at": now,
        # 每次真实抓取都算一次首图检查；失败也持久化该标记，避免旧正文在
        # 公开 API 每次读取时无限回源。手动强制抓取仍会再次检查并更新。
        "first_image_checked": 1,
        "status": "error",
        "error_code": "fetch_error",
    }

    try:
        page = fetcher.fetch(url)
    except ContentDependencyMissing:
        raise
    except ArticleFetchError as exc:
        row["status"] = exc.status
        row["error_code"] = exc.code
        return row
    except Exception:
        return row

    try:
        article = extract_article(
            page.html, article_id=article_id, source_url=page.url
        )
    except ContentDependencyMissing:
        raise
    except Exception:
        row["http_status"] = page.http_status
        row["error_code"] = "extract_failed"
        return row

    row["http_status"] = page.http_status
    row["url"] = page.url
    row["title"] = article.title
    row["summary"] = article.summary
    row["first_image_url"] = article.first_image_url
    row["published_date"] = article.published_date
    row["published_date_source"] = article.published_date_source
    row["extract_method"] = article.method
    row["content_chars"] = article.chars

    if article.chars > 0:
        row["status"] = STATUS_OK
        row["content"] = article.text
        row["error_code"] = None
        row["succeeded_at"] = now
    else:
        # 抽不到正文是被记录的结果,不是异常。多半意味着版式变了。
        row["status"] = STATUS_EMPTY
        row["error_code"] = "empty_content"
    return row


@dataclass
class JobSnapshot:
    job_id: str = ""
    state: str = STATE_IDLE
    days: int = 0
    top: int = 0
    include_today: bool = False
    published_days: Optional[int] = None
    force: bool = False
    total: int = 0
    done: int = 0
    skipped: int = 0
    ok: int = 0
    empty: int = 0
    not_found: int = 0
    blocked: int = 0
    timeout: int = 0
    error: int = 0
    by_method: Dict[str, int] = field(default_factory=dict)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    error_code: Optional[str] = None

    def copy(self) -> "JobSnapshot":
        clone = JobSnapshot(**self.__dict__)
        clone.by_method = dict(self.by_method)
        return clone


class ContentRunner:
    def __init__(
        self,
        *,
        fetcher: Optional[ArticleFetcher] = None,
        max_workers: int = DEFAULT_MAX_WORKERS,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        clock: Optional[Callable[[], datetime]] = None,
    ) -> None:
        self._fetcher = fetcher
        self._owns_fetcher = fetcher is None
        self._max_workers = max_workers
        self._chunk_size = chunk_size
        self._clock = clock or (lambda: datetime.now(timezone.utc))

        self._lock = threading.Lock()
        self._snapshot = JobSnapshot()
        self._thread: Optional[threading.Thread] = None
        self._cancel = threading.Event()

    # ---------- 对外 ----------

    def snapshot(self) -> JobSnapshot:
        with self._lock:
            return self._snapshot.copy()

    def is_running(self) -> bool:
        with self._lock:
            return self._snapshot.state not in TERMINAL_STATES

    def start(
        self,
        *,
        resolve: TargetResolver,
        days: int,
        top: int,
        include_today: bool = False,
        published_days: Optional[int] = None,
        force: bool = False,
    ) -> JobSnapshot:
        with self._lock:
            if self._snapshot.state not in TERMINAL_STATES:
                raise JobAlreadyRunning("a content fetch job is already running")
            self._cancel = threading.Event()
            self._snapshot = JobSnapshot(
                job_id=uuid.uuid4().hex,
                state=STATE_RESOLVING,
                days=days,
                top=top,
                include_today=include_today,
                published_days=published_days,
                force=force,
                started_at=db.now_iso(),
            )
            snapshot = self._snapshot.copy()

        self._thread = threading.Thread(
            target=self._run,
            args=(resolve, force, self._cancel),
            name="article-content-runner",
            daemon=True,
        )
        self._thread.start()
        return snapshot

    def cancel(self) -> JobSnapshot:
        self._cancel.set()
        return self.snapshot()

    def close(self) -> None:
        """关服务时调用。join 必须带超时,否则 uvicorn 会被挂住。"""
        self._cancel.set()
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=10)
        if self._owns_fetcher and self._fetcher is not None:
            self._fetcher.close()
            self._fetcher = None

    # ---------- 内部 ----------

    def _client(self) -> ArticleFetcher:
        if self._fetcher is None:
            self._fetcher = ArticleFetcher()
            self._owns_fetcher = True
        return self._fetcher

    def _update(self, **changes) -> None:
        with self._lock:
            for key, value in changes.items():
                setattr(self._snapshot, key, value)

    def _bump(self, field_name: str, amount: int = 1) -> None:
        with self._lock:
            setattr(
                self._snapshot, field_name, getattr(self._snapshot, field_name) + amount
            )

    def _run(
        self, resolve: TargetResolver, force: bool, cancel: threading.Event
    ) -> None:
        try:
            targets = resolve()
        except ContentDependencyMissing:
            self._finish(STATE_FAILED, "content_fetch_unavailable")
            return
        except Exception:
            # 上游异常原文绝不外泄,只给稳定短码
            self._finish(STATE_FAILED, "target_resolve_failed")
            return

        if cancel.is_set():
            self._finish(STATE_CANCELLED, None)
            return

        try:
            pending = self._select_pending(targets, force=force)
        except Exception:
            self._finish(STATE_FAILED, "state_lookup_failed")
            return

        self._update(
            state=STATE_FETCHING,
            total=len(pending),
            skipped=len(targets) - len(pending),
        )

        if not pending:
            self._finish(STATE_FINISHED, None)
            return

        try:
            self._fetch_all(pending, cancel)
        except ContentDependencyMissing:
            self._finish(STATE_FAILED, "content_fetch_unavailable")
            return
        except _CircuitOpen:
            self._finish(STATE_ABORTED_BLOCKED, "blocked_circuit_open")
            return
        except Exception:
            self._finish(STATE_FAILED, "fetch_failed")
            return

        self._finish(STATE_CANCELLED if cancel.is_set() else STATE_FINISHED, None)

    def _select_pending(self, targets: List[Target], *, force: bool) -> List[Target]:
        """按重试策略滤掉不该抓的。这是幂等性的来源。"""
        keys = [(language, article_id) for language, article_id, _ in targets]
        states = db.get_article_content_states(keys)
        now = self._clock()
        return [
            target
            for target in targets
            if should_fetch(
                states.get((target[0], target[1])), now=now, force=force
            )
        ]

    def _fetch_all(self, targets: List[Target], cancel: threading.Event) -> None:
        fetcher = self._client()
        consecutive_blocked = 0
        buffer: List[Dict] = []

        with ThreadPoolExecutor(max_workers=self._max_workers) as pool:
            for row in pool.map(lambda t: self._fetch_one(fetcher, t, cancel), targets):
                if row is None:  # 已取消,跳过剩下的
                    continue

                if row["status"] == "blocked":
                    consecutive_blocked += 1
                else:
                    consecutive_blocked = 0

                buffer.append(row)
                self._record(row)

                if len(buffer) >= self._chunk_size:
                    self._commit(buffer)
                    buffer = []

                if consecutive_blocked >= BLOCKED_CIRCUIT_LIMIT:
                    self._commit(buffer)
                    raise _CircuitOpen()

        self._commit(buffer)

    def _fetch_one(
        self, fetcher: ArticleFetcher, target: Target, cancel: threading.Event
    ) -> Optional[Dict]:
        """抓单篇。除依赖缺失外永不向外抛——单篇失败不能拖垮整批。"""
        if cancel.is_set():
            return None
        return fetch_article_row(fetcher, target)

    def _record(self, row: Dict) -> None:
        with self._lock:
            snapshot = self._snapshot
            snapshot.done += 1
            status = row.get("status", "error")
            if hasattr(snapshot, status):
                setattr(snapshot, status, getattr(snapshot, status) + 1)
            else:
                snapshot.error += 1
            if row.get("status") in (STATUS_OK, STATUS_EMPTY):
                method = row.get("extract_method") or ""
                snapshot.by_method[method] = snapshot.by_method.get(method, 0) + 1

    def _commit(self, rows: List[Dict]) -> None:
        if not rows:
            return
        with db.get_conn() as conn:
            db.upsert_article_contents(conn, rows)

    def _finish(self, state: str, error_code: Optional[str]) -> None:
        self._update(state=state, error_code=error_code, finished_at=db.now_iso())


class _CircuitOpen(RuntimeError):
    """连续被拦太多次,主动熔断。"""
