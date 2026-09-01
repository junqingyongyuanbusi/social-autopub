"""正文抓取的重试策略:一篇文章这次要不要抓.

纯函数,不碰网络也不碰数据库——这是「跳过已抓」幂等性的唯一判定处,
值得能用真值表把每个分支钉死。

实测榜单里约 10% 的文章是死链(30 篇里 3 篇 404),190 篇一天就是 ~19 篇。
如果每天都去重试它们,纯属白烧配额和暴露面,所以 not_found 有冷却期,
且试满 NOT_FOUND_MAX_ATTEMPTS 次后永久放弃(除非显式 force)。

但 404 分两种,必须区别对待(2026-07-30 实锤:强制重抓 198 篇,12 篇
succeeded_at 非空的行拿到 404,几分钟后逐一探测两个域名全部 200):
  - 从未成功过的 404 → 大概率真死链,按上面的长冷却+放弃策略;
  - 成功抓到过正文又 404 → 大概率上游瞬时 404,按瞬时错误的节奏重试,
    不受次数上限锁死,否则一次抽风就把活文章永久钉成「已下架」。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional


# 抓取结果状态
STATUS_OK = "ok"
STATUS_EMPTY = "empty"
STATUS_NOT_FOUND = "not_found"
STATUS_BLOCKED = "blocked"
STATUS_TIMEOUT = "timeout"
STATUS_ERROR = "error"

ALL_STATUSES = (
    STATUS_OK,
    STATUS_EMPTY,
    STATUS_NOT_FOUND,
    STATUS_BLOCKED,
    STATUS_TIMEOUT,
    STATUS_ERROR,
)

# 各状态多久之后才允许再试。None = 永不重试。
RETRY_COOLDOWN: Dict[str, Optional[timedelta]] = {
    STATUS_OK: None,
    # 抽取为空多半是版式变了,猛捶没用,等一天再看
    STATUS_EMPTY: timedelta(hours=24),
    STATUS_NOT_FOUND: timedelta(days=7),
    # 被 Akamai 挡了,退避久一点,别把 IP 撞进黑名单
    STATUS_BLOCKED: timedelta(hours=1),
    STATUS_TIMEOUT: timedelta(minutes=30),
    STATUS_ERROR: timedelta(minutes=30),
}

DEFAULT_COOLDOWN = timedelta(minutes=30)
NOT_FOUND_MAX_ATTEMPTS = 3


def _parse_timestamp(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def should_fetch(
    row: Optional[Dict[str, Any]], *, now: datetime, force: bool = False
) -> bool:
    """这条记录现在该不该重新抓。

    row 为 None 表示库里还没有 → 抓。force 无视一切冷却。
    """
    if force or row is None:
        return True

    if now.tzinfo is not None:
        now = now.astimezone(timezone.utc).replace(tzinfo=None)

    status = row.get("status")
    if status == STATUS_OK:
        return False

    if status == STATUS_NOT_FOUND and not row.get("succeeded_at"):
        # 从未成功过的 404:多半真死链。注意 attempt_count 是该行的总尝试
        # 数(含 blocked/timeout),从未成功的行里它约等于失败次数,当上限用
        # 足够准。
        try:
            attempts = int(row.get("attempt_count") or 0)
        except (TypeError, ValueError):
            attempts = 0
        if attempts >= NOT_FOUND_MAX_ATTEMPTS:
            return False
        cooldown: Optional[timedelta] = RETRY_COOLDOWN[STATUS_NOT_FOUND]
    elif status == STATUS_NOT_FOUND:
        # 成功过又 404:按瞬时错误对待,尽快复查让它自愈
        cooldown = RETRY_COOLDOWN[STATUS_ERROR]
    else:
        cooldown = RETRY_COOLDOWN.get(status, DEFAULT_COOLDOWN)
    if cooldown is None:
        return False

    last = _parse_timestamp(row.get("fetched_at"))
    # 时间戳缺失或脏了就别把这条永久锁死,当作可以重试
    if last is None:
        return True
    return now - last >= cooldown
