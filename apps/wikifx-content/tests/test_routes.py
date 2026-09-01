from __future__ import annotations

from fastapi.testclient import TestClient

from app import config, db
from app.articles import router as article_router
from app.main import app


ARTICLE_ID = "202608274774520712"
ARTICLE_URL = f"https://www.wikifx.com/en/newsdetail/{ARTICLE_ID}.html"


def test_health_reports_missing_fetch_dependency(monkeypatch, tmp_path) -> None:
    _configure(monkeypatch, tmp_path)
    monkeypatch.setattr(config, "CONTENT_API_KEY", "")
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 503
    assert response.json()["ok"] is False
    assert response.json()["content_api_key_configured"] is False


def test_health_validates_an_optional_supplied_bearer_key(monkeypatch, tmp_path) -> None:
    _configure(monkeypatch, tmp_path)
    with TestClient(app) as client:
        invalid = client.get(
            "/healthz", headers={"Authorization": "Bearer wrong-key"}
        )
        valid = client.get(
            "/healthz", headers={"Authorization": "Bearer test-content-key"}
        )
    assert invalid.status_code == 401
    assert invalid.json()["detail"]["code"] == "content_api_unauthorized"
    assert valid.status_code == 200
    assert valid.json()["ok"] is True


def test_sidecar_requires_internal_bearer_key(monkeypatch, tmp_path) -> None:
    _configure(monkeypatch, tmp_path)
    with TestClient(app) as client:
        response = client.get(f"/api/articles/content/en/{ARTICLE_ID}")
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "content_api_unauthorized"


def test_missing_article_is_distinguishable_from_upstream_not_found(monkeypatch, tmp_path) -> None:
    _configure(monkeypatch, tmp_path)
    with TestClient(app) as client:
        response = client.get(
            f"/api/articles/content/en/{ARTICLE_ID}",
            headers={"Authorization": "Bearer test-content-key"},
        )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "content_not_fetched"


def test_force_fetch_persists_and_can_be_read(monkeypatch, tmp_path) -> None:
    _configure(monkeypatch, tmp_path)
    calls = []

    def fake_fetch(fetcher, target):
        calls.append(target)
        language, article_id, url = target
        return {
            "language": language,
            "article_id": article_id,
            "url": url,
            "title": "Tattvam Review 2026",
            "summary": "A summary",
            "first_image_url": "https://cdn.example.com/cover.jpg",
            "first_image_checked": 1,
            "content": "正文内容 " * 80,
            "content_chars": 640,
            "published_date": "2026-08-27",
            "published_date_source": "article_id",
            "extract_method": "article-info",
            "status": "ok",
            "http_status": 200,
            "error_code": None,
            "fetched_at": "2026-09-01T12:00:00",
            "succeeded_at": "2026-09-01T12:00:00",
        }

    monkeypatch.setattr(article_router, "fetch_article_row", fake_fetch)
    headers = {"Authorization": "Bearer test-content-key"}
    with TestClient(app) as client:
        fetched = client.post(
            f"/api/articles/content/en/{ARTICLE_ID}/fetch", headers=headers
        )
        read = client.get(f"/api/articles/content/en/{ARTICLE_ID}", headers=headers)

    assert fetched.status_code == 200
    assert fetched.json()["status"] == "ok"
    assert fetched.json()["content"].startswith("正文内容")
    assert read.status_code == 200
    assert read.json()["first_image_url"] == "https://cdn.example.com/cover.jpg"
    assert len(calls) == 1


def test_resolve_uses_persisted_body_without_refetching(monkeypatch, tmp_path) -> None:
    _configure(monkeypatch, tmp_path)
    with db.get_conn() as conn:
        db.upsert_article_contents(
            conn,
            [
                {
                    "language": "en",
                    "article_id": ARTICLE_ID,
                    "url": ARTICLE_URL,
                    "title": "Cached article",
                    "content": "cached body",
                    "content_chars": 11,
                    "first_image_checked": 1,
                    "status": "ok",
                    "fetched_at": "2026-09-01T12:00:00",
                    "succeeded_at": "2026-09-01T12:00:00",
                }
            ],
        )

    def fail_if_called(*_args):
        raise AssertionError("persisted content should be returned without a refetch")

    monkeypatch.setattr(article_router, "fetch_article_row", fail_if_called)
    with TestClient(app) as client:
        response = client.post(
            "/api/articles/content/resolve",
            headers={"Authorization": "Bearer test-content-key"},
            json={"items": [{"language": "en", "article_id": ARTICLE_ID, "article_url": ARTICLE_URL}]},
        )
    assert response.status_code == 200
    assert response.json()["items"][0]["content"] == "cached body"
    assert response.json()["items"][0]["content_status"] == "stored"


def test_force_fetch_tries_alternate_extension_after_not_found(monkeypatch, tmp_path) -> None:
    _configure(monkeypatch, tmp_path)
    calls = []

    def fake_fetch(fetcher, target):
        calls.append(target[2])
        if len(calls) == 1:
            return {
                "language": "en",
                "article_id": ARTICLE_ID,
                "url": target[2],
                "status": "not_found",
                "error_code": "not_found",
                "first_image_checked": 1,
                "fetched_at": db.now_iso(),
            }
        return {
            "language": "en",
            "article_id": ARTICLE_ID,
            "url": target[2],
            "title": "Recovered article",
            "content": "recovered body",
            "content_chars": 14,
            "first_image_checked": 1,
            "status": "ok",
            "http_status": 200,
            "fetched_at": db.now_iso(),
            "succeeded_at": db.now_iso(),
        }

    monkeypatch.setattr(article_router, "fetch_article_row", fake_fetch)
    with TestClient(app) as client:
        response = client.post(
            f"/api/articles/content/en/{ARTICLE_ID}/fetch",
            headers={"Authorization": "Bearer test-content-key"},
        )
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert calls == [
        f"https://www.wikifx.com/en/newsdetail/{ARTICLE_ID}.html",
        f"https://www.wikifx.com/en/newsdetail/{ARTICLE_ID}.htm",
    ]


def test_resolve_honors_not_found_cooldown(monkeypatch, tmp_path) -> None:
    _configure(monkeypatch, tmp_path)
    with db.get_conn() as conn:
        db.upsert_article_contents(
            conn,
            [
                {
                    "language": "en",
                    "article_id": ARTICLE_ID,
                    "url": ARTICLE_URL,
                    "first_image_checked": 1,
                    "status": "not_found",
                    "error_code": "not_found",
                    "fetched_at": db.now_iso(),
                }
            ],
        )

    def fail_if_called(*_args):
        raise AssertionError("a recent not_found row is still cooling down")

    monkeypatch.setattr(article_router, "fetch_article_row", fail_if_called)
    with TestClient(app) as client:
        response = client.post(
            "/api/articles/content/resolve",
            headers={"Authorization": "Bearer test-content-key"},
            json={"items": [{"language": "en", "article_id": ARTICLE_ID, "article_url": ARTICLE_URL}]},
        )
    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["status"] == "not_found"
    assert item["content_status"] == "fetch_failed"


def test_resolve_rejects_a_url_that_does_not_match_the_key(monkeypatch, tmp_path) -> None:
    _configure(monkeypatch, tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/articles/content/resolve",
            headers={"Authorization": "Bearer test-content-key"},
            json={
                "items": [
                    {
                        "language": "en",
                        "article_id": ARTICLE_ID,
                        "article_url": "https://example.com/en/newsdetail/"
                        + ARTICLE_ID
                        + ".html",
                    }
                ]
            },
        )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_article_url"


def _configure(monkeypatch, tmp_path) -> None:
    data_dir = tmp_path / "data"
    monkeypatch.setattr(config, "DATA_DIR", data_dir)
    monkeypatch.setattr(config, "DB_PATH", data_dir / "wikifx.db")
    monkeypatch.setattr(config, "IMAGES_DIR", data_dir / "images")
    monkeypatch.setattr(config, "CONTENT_API_KEY", "test-content-key")
    db.init_db()
