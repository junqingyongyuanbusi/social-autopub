from __future__ import annotations

from app import config, db


def test_failed_retry_does_not_erase_last_successful_body(monkeypatch, tmp_path) -> None:
    data_dir = tmp_path / "data"
    monkeypatch.setattr(config, "DATA_DIR", data_dir)
    monkeypatch.setattr(config, "DB_PATH", data_dir / "wikifx.db")
    monkeypatch.setattr(config, "IMAGES_DIR", data_dir / "images")
    db.init_db()

    key = {"language": "en", "article_id": "202608274774520712"}
    with db.get_conn() as conn:
        db.upsert_article_contents(
            conn,
            [
                {
                    **key,
                    "url": "https://www.wikifx.com/en/newsdetail/202608274774520712.html",
                    "title": "Tattvam Review",
                    "content": "A" * 300,
                    "content_chars": 300,
                    "status": "ok",
                    "fetched_at": "2026-09-01T10:00:00",
                    "succeeded_at": "2026-09-01T10:00:00",
                }
            ],
        )
        db.upsert_article_contents(
            conn,
            [
                {
                    **key,
                    "status": "not_found",
                    "error_code": "not_found",
                    "http_status": 404,
                    "first_image_checked": 1,
                    "fetched_at": "2026-09-01T11:00:00",
                }
            ],
        )

    row = db.get_article_content(**key)
    assert row is not None
    assert row["status"] == "not_found"
    assert row["content"] == "A" * 300
    assert row["attempt_count"] == 2
    assert row["succeeded_at"] == "2026-09-01T10:00:00"
