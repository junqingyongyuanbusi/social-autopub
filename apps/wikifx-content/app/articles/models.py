from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from pydantic import BaseModel, Field


@dataclass(frozen=True)
class GAArticleRow:
    hostname: str
    page_path: str
    page_title: str
    view_count: int
    active_users: int
    engagement_seconds: float
    country: str = ""
    region: str = ""


@dataclass(frozen=True)
class GAReport:
    rows: list[GAArticleRow]
    sampled: bool = False
    data_loss_from_other_row: bool = False


class DataQuality(BaseModel):
    sampled: bool
    data_loss_from_other_row: bool
    skipped_rows: int


class ArticleItem(BaseModel):
    language: str
    article_id: str
    article_url: str
    article_title: str
    published_date: Optional[str] = None
    published_date_source: Optional[str] = None
    content_country: Optional[str] = None
    content_region: Optional[str] = None
    view_count: int
    active_users: int
    avg_engagement_seconds: float
    click_count: Optional[int] = None
    read_count: Optional[int] = None
    content: Optional[str] = None


class TopArticlesResponse(BaseModel):
    statistics_start: str
    statistics_end: str
    days: int
    top: int
    include_today: bool
    published_days: Optional[int] = None
    published_start: Optional[str] = None
    published_end: Optional[str] = None
    generated_at: str
    property_id: str
    data_quality: DataQuality
    items: list[ArticleItem]


# ---------- 文章正文 ----------
#
# 正文状态刻意不塞进 TopArticlesResponse:那个响应在 Go 层有 Redis 缓存
# (软 TTL 30 分钟),而正文状态是抓一次就变的高频数据,塞进去会被缓存冻住,
# 逼用户点「强制刷新」重跑 27~54s 的 GA 查询。两者分开各走各的缓存策略。


class ArticleContentKey(BaseModel):
    language: str = Field(..., max_length=16, description="URL 里的语言段")
    article_id: str = Field(..., max_length=64, description="文章 ID")


class ArticleContentIndexBody(BaseModel):
    items: list[ArticleContentKey] = Field(
        ..., description="要查状态的文章,最多 1000 条"
    )


class ArticleContentState(BaseModel):
    """正文元信息,不含正文本身(列表页用)。"""

    language: str
    article_id: str
    url: Optional[str] = None
    title: Optional[str] = None
    # p.des 编辑导语,与正文分离存储(不含 "摘要：/Abstract：" 标签前缀)
    summary: Optional[str] = None
    # 正文首张有效图片；正文无图时回退 og:image / twitter:image
    first_image_url: Optional[str] = None
    content_chars: Optional[int] = None
    published_date: Optional[str] = None
    published_date_source: Optional[str] = None
    extract_method: Optional[str] = None
    status: str
    http_status: Optional[int] = None
    error_code: Optional[str] = None
    attempt_count: Optional[int] = None
    first_fetched_at: Optional[str] = None
    fetched_at: Optional[str] = None
    succeeded_at: Optional[str] = None


class ArticleContentIndexResponse(BaseModel):
    items: list[ArticleContentState]


class ArticleContentRecordsSummary(BaseModel):
    total: int
    ok: int
    empty: int
    not_found: int
    failed: int
    total_content_chars: int
    latest_fetched_at: Optional[str] = None


class ArticleContentRecordsResponse(BaseModel):
    summary: ArticleContentRecordsSummary
    items: list[ArticleContentState]
    total: int
    page: int
    page_size: int
    languages: list[str]


class ArticleContentDetail(ArticleContentState):
    content: Optional[str] = None


class ArticleContentResolveItem(ArticleContentKey):
    article_url: str = Field(..., max_length=2048, description="榜单返回的文章 URL")


class ArticleContentResolveBody(BaseModel):
    items: list[ArticleContentResolveItem] = Field(
        ..., max_length=400, description="需要返回正文的榜单文章，最多 400 条"
    )


class ArticleContentResolved(ArticleContentDetail):
    content_status: str = Field(
        ..., description="stored=库中已有，fetched=本次抓取入库，fetch_failed=抓取失败"
    )
    content_message: str = Field(..., description="正文来源或抓取结果提示")


class ArticleContentResolveResponse(BaseModel):
    items: list[ArticleContentResolved]


class ContentFetchBody(BaseModel):
    days: int = Field(3, ge=1, le=3, description="访问统计窗口天数,与榜单一致")
    top: int = Field(10, ge=1, le=20, description="每种语言取前几篇")
    include_today: bool = Field(False, description="访问统计是否包含今天的未完整数据")
    published_days: Optional[int] = Field(
        None,
        ge=1,
        le=365,
        description="文章发布日期最近天数;null 表示不限",
    )
    force: bool = Field(
        False, description="true 则无视冷却与已入库状态,强制重抓"
    )


class ContentJobStatus(BaseModel):
    job_id: str
    state: str
    days: int
    top: int
    include_today: bool = False
    published_days: Optional[int] = None
    force: bool
    total: int
    done: int
    skipped: int
    ok: int
    empty: int
    not_found: int
    blocked: int
    timeout: int
    error: int
    # 抽取方式分布。正常应全为 article-info;出现 article-c / longest-block
    # / "" 就意味着 WikiFX 版式可能变了,这是改版的唯一探测器。
    by_method: dict[str, int]
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    error_code: Optional[str] = None
