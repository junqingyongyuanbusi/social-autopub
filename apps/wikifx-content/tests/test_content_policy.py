from datetime import datetime, timedelta, timezone

from app.articles.content_policy import should_fetch


def test_ok_is_idempotent_but_force_overrides() -> None:
    now = datetime(2026, 9, 1, 12, 0, 0)
    row = {"status": "ok", "fetched_at": "2026-08-01T00:00:00"}
    assert should_fetch(row, now=now) is False
    assert should_fetch(row, now=now, force=True) is True


def test_not_found_has_cooldown_and_attempt_limit() -> None:
    now = datetime(2026, 9, 1, 12, 0, 0)
    recent = {
        "status": "not_found",
        "attempt_count": 1,
        "fetched_at": (now - timedelta(days=1)).isoformat(),
    }
    exhausted = {
        **recent,
        "attempt_count": 3,
        "fetched_at": (now - timedelta(days=30)).isoformat(),
    }
    assert should_fetch(recent, now=now) is False
    assert should_fetch(exhausted, now=now) is False
    assert should_fetch({**recent, "fetched_at": (now - timedelta(days=8)).isoformat()}, now=now)


def test_timezone_timestamps_are_compared_without_type_errors() -> None:
    now = datetime(2026, 9, 1, 12, 0, 0, tzinfo=timezone.utc)
    row = {
        "status": "timeout",
        "fetched_at": "2026-09-01T11:00:00+00:00",
    }
    assert should_fetch(row, now=now) is True


def test_a_previously_successful_404_is_retried_on_shorter_error_schedule() -> None:
    now = datetime(2026, 9, 1, 12, 0, 0)
    row = {
        "status": "not_found",
        "succeeded_at": "2026-08-20T00:00:00",
        "fetched_at": (now - timedelta(minutes=31)).isoformat(),
    }
    assert should_fetch(row, now=now) is True
