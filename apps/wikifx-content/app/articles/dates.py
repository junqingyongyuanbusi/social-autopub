from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

_ARTICLE_ID_DATE = re.compile(r"^(20\d{2})(\d{2})(\d{2})")
MAX_PUBLICATION_DAYS = 365


def _local_now(timezone_name: str, now: datetime | None) -> datetime:
    if now is not None and (now.tzinfo is None or now.utcoffset() is None):
        raise ValueError("now must be timezone-aware")

    timezone = ZoneInfo(timezone_name)
    return now.astimezone(timezone) if now is not None else datetime.now(timezone)


def traffic_date_range(
    days: int,
    timezone_name: str,
    *,
    include_today: bool = False,
    now: datetime | None = None,
) -> tuple[date, date]:
    """Return the GA traffic window in the configured report timezone."""
    if days not in (1, 2, 3):
        raise ValueError("days must be between 1 and 3")

    local_now = _local_now(timezone_name, now)
    end = local_now.date()
    if not include_today:
        end -= timedelta(days=1)
    start = end - timedelta(days=days - 1)
    return start, end


def complete_date_range(
    days: int,
    timezone_name: str,
    *,
    now: datetime | None = None,
) -> tuple[date, date]:
    """Backward-compatible complete-day window, excluding today."""
    return traffic_date_range(
        days,
        timezone_name,
        include_today=False,
        now=now,
    )


def publication_date_range(
    days: int,
    timezone_name: str,
    *,
    now: datetime | None = None,
) -> tuple[date, date]:
    """Return an inclusive article publication window ending today."""
    if not 1 <= days <= MAX_PUBLICATION_DAYS:
        raise ValueError(f"days must be between 1 and {MAX_PUBLICATION_DAYS}")

    end = _local_now(timezone_name, now).date()
    start = end - timedelta(days=days - 1)
    return start, end


def article_id_date(article_id: str) -> date | None:
    """Parse the YYYYMMDD prefix used by WikiFX article identifiers."""
    match = _ARTICLE_ID_DATE.match(article_id or "")
    if match is None:
        return None
    try:
        parsed = date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None
    if parsed < date(2000, 1, 1):
        return None
    return parsed
