from __future__ import annotations

import pytest

from app.articles.fetcher import (
    ArticleBlocked,
    ArticleFetcher,
    ArticleNotFound,
    ArticleTimeout,
    FetchedPage,
    swap_host,
)


class FakeResponse:
    def __init__(self, status_code: int, text: str = "<html>") -> None:
        self.status_code = status_code
        self.text = text


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.urls = []

    def get(self, url, **kwargs):
        self.urls.append(url)
        return self.responses.pop(0)

    def close(self):
        pass


def test_fetcher_retries_the_official_host_on_404() -> None:
    session = FakeSession([FakeResponse(404), FakeResponse(200, "body")])
    fetcher = ArticleFetcher(session=session)
    page = fetcher.fetch("https://www.wikifx.com/en/newsdetail/202608274774520712.html")
    assert isinstance(page, FetchedPage)
    assert page.http_status == 200
    assert session.urls == [
        "https://www.wikifx.com/en/newsdetail/202608274774520712.html",
        "https://aws-www.wikifx.com/en/newsdetail/202608274774520712.html",
    ]


def test_swap_host_rejects_non_official_host() -> None:
    assert swap_host("https://example.com/article") is None


@pytest.mark.parametrize(
    "status, error_type",
    [(403, ArticleBlocked), (429, ArticleBlocked), (404, ArticleNotFound)],
)
def test_fetcher_maps_http_statuses(status, error_type) -> None:
    fetcher = ArticleFetcher(session=FakeSession([FakeResponse(status)]))
    with pytest.raises(error_type):
        fetcher.fetch("https://example.com/article")
