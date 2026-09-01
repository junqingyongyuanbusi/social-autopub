"""文章页抓取:过 Akamai 拿 HTML.

WikiFX 文章页挂了 Akamai 边缘防护,普通 httpx/requests 一律 403——完整
Chrome 请求头、Googlebot UA、甚至 robots.txt 都被挡。curl_cffi 通过复刻真实
Chrome 的 TLS/HTTP2 指纹能正常拿到 200,这是实测唯一可行的方式。

抓的是 WikiFX 自家文章供自家后台使用,并发限 6(实测无限流),定时任务
每天一次。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from threading import Lock
from typing import Any, Dict, Mapping, Optional
from urllib.parse import urlsplit, urlunsplit

from app.articles.extract import ContentDependencyMissing

try:  # 依赖缺失不能让整个 sidecar 起不来:GA 榜单和交易商接口与此无关
    from curl_cffi import requests as _curl_requests
    from curl_cffi.requests import exceptions as _curl_exceptions
except ImportError:  # pragma: no cover - 取决于部署环境
    _curl_requests = None
    _curl_exceptions = None


# 模拟的浏览器指纹。提成常量是为了将来一行可换——curl_cffi 大版本之间
# profile 会变,悄悄换掉会让抓取整体失败,所以 requirements 里也加了上限。
IMPERSONATE = "chrome"
CONNECT_TIMEOUT = 10.0
READ_TIMEOUT = 30.0

# 榜单里同一篇文章可能挂在两个域名下,一个 404 就换另一个再试一次
HOST_FALLBACKS = {
    "www.wikifx.com": "aws-www.wikifx.com",
    "aws-www.wikifx.com": "www.wikifx.com",
}


class ArticleFetchError(RuntimeError):
    """抓取失败的基类。code 会落进 article_contents.error_code。"""

    code = "fetch_error"
    status = "error"


class ArticleNotFound(ArticleFetchError):
    code = "not_found"
    status = "not_found"


class ArticleBlocked(ArticleFetchError):
    """403/429——Akamai 拦了。"""

    code = "blocked"
    status = "blocked"


class ArticleTimeout(ArticleFetchError):
    code = "timeout"
    status = "timeout"


class ArticleUpstreamError(ArticleFetchError):
    code = "upstream_error"
    status = "error"


@dataclass(frozen=True)
class FetchedPage:
    url: str
    html: str
    http_status: int


def proxies_from_environ(
    environ: Optional[Mapping[str, str]] = None,
) -> Optional[Dict[str, str]]:
    """从环境变量拼代理配置。

    必须显式传给 curl,不能指望它自己读:libcurl 出于安全只认小写的
    `http_proxy`,而服务器的 EnvironmentFile 里写的是大写 `HTTP_PROXY`。
    现在抓 https 能跑是因为大写 `HTTPS_PROXY` libcurl 认;一旦哪天改抓
    http,代理会被静默忽略然后全部超时,极难排查。
    """
    env = environ if environ is not None else os.environ
    http_proxy = env.get("HTTP_PROXY") or env.get("http_proxy")
    https_proxy = env.get("HTTPS_PROXY") or env.get("https_proxy")

    proxies: Dict[str, str] = {}
    if http_proxy:
        proxies["http"] = http_proxy
    if https_proxy:
        proxies["https"] = https_proxy
    return proxies or None


def swap_host(url: str) -> Optional[str]:
    """把 www 和 aws-www 互换,路径不动。不认识的域名返回 None。"""
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    alternate = HOST_FALLBACKS.get((parts.hostname or "").lower())
    if alternate is None:
        return None
    return urlunsplit(
        (parts.scheme, alternate, parts.path, parts.query, parts.fragment)
    )


class ArticleFetcher:
    def __init__(
        self,
        *,
        session: Any = None,
        impersonate: str = IMPERSONATE,
        proxies: Optional[Dict[str, str]] = None,
        environ: Optional[Mapping[str, str]] = None,
        connect_timeout: float = CONNECT_TIMEOUT,
        read_timeout: float = READ_TIMEOUT,
    ) -> None:
        self._session = session
        self._owns_session = False
        self._session_lock = Lock()
        self.impersonate = impersonate
        self.proxies = proxies if proxies is not None else proxies_from_environ(environ)
        self.timeout = (connect_timeout, read_timeout)

    def _client(self):
        if self._session is None:
            with self._session_lock:
                if self._session is None:
                    if _curl_requests is None:
                        raise ContentDependencyMissing("curl_cffi is not installed")
                    self._session = _curl_requests.Session()
                    self._owns_session = True
        return self._session

    def close(self) -> None:
        """只关自己创建的 session,注入进来的由调用方负责。"""
        with self._session_lock:
            if not self._owns_session:
                return
            session = self._session
            self._session = None
            self._owns_session = False
        close = getattr(session, "close", None)
        if callable(close):
            close()

    def _fetch_once(self, url: str) -> FetchedPage:
        client = self._client()
        try:
            response = client.get(
                url,
                impersonate=self.impersonate,
                timeout=self.timeout,
                proxies=self.proxies,
            )
        except Exception as exc:  # 统一翻译成自己的异常层次
            raise _translate_error(exc) from None

        status = int(getattr(response, "status_code", 0) or 0)
        if status in (404, 410):
            raise ArticleNotFound(f"article not found: {status}")
        if status in (403, 429):
            raise ArticleBlocked(f"blocked by upstream: {status}")
        if status >= 400 or status == 0:
            raise ArticleUpstreamError(f"unexpected status: {status}")

        return FetchedPage(url=url, html=response.text or "", http_status=status)

    def fetch(self, url: str) -> FetchedPage:
        """抓一篇。404 时在 www / aws-www 之间换一次域名再试。"""
        try:
            return self._fetch_once(url)
        except ArticleNotFound:
            alternate = swap_host(url)
            if alternate is None:
                raise
            return self._fetch_once(alternate)


def _translate_error(exc: Exception) -> ArticleFetchError:
    if _curl_exceptions is not None:
        if isinstance(exc, _curl_exceptions.Timeout):
            return ArticleTimeout("request timed out")
        if isinstance(exc, _curl_exceptions.ProxyError):
            return ArticleUpstreamError("proxy error")
        if isinstance(exc, _curl_exceptions.RequestException):
            return ArticleUpstreamError("upstream request failed")
    if isinstance(exc, ContentDependencyMissing):
        raise exc
    return ArticleUpstreamError("upstream request failed")
