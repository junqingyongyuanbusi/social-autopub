"""文章正文抽取:HTML → 纯文本正文 + 标题 + 摘要 + 发布日期.

纯函数模块,不发网络请求、不碰数据库,便于用本地 HTML 固件测试。

抽取分四级,每级都把用的是哪一级记进 `method`——WikiFX 改版时这个字段
是唯一的探测器(正常情况下永远是 article-info,一旦出现别的值就说明版式
变了)。

  1. article-info 精确:article-c 容器内的 `div.info#articleInfo`——这才是
     正文本体。标题/作者行/摘要/免责声明/标签/上下篇导航/相关交易商/底部
     交易商跑马灯全是它的兄弟节点,选它就天然剔除了这些杂物(2026-07-30
     实测 12 种语言样本全部命中此结构)。
  2. article-c 整容器:info 缺席或不唯一时退回整个容器。会混进上述杂物,
     所以这一级也算预警信号。
  3. article-c 宽松:精确 token 匹配落空时退到子串匹配。
  4. 最长正文块:按块级标签扫候选,用链接密度淘汰导航/菜单区,再取「持有
     大部分正文的最紧凑容器」。见 _fallback_longest_block 的说明。

四级都不满足时返回空文本(method=""),由调用方记成 empty 状态——这是一个
被记录的结果,不是异常。

正文选出后还有一道保守的尾部修剪:WikiFX 编辑常在文末手打推广块(▶ 引导、
———— 分隔线、┏━┓ 框、App 下载短链),这些是普通 <p>,没有 class 可认,
只能按内容特征从尾部剪,见 _trim_promo_tail。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional
from urllib.parse import urljoin, urlsplit

from app.articles.dates import article_id_date

try:  # lxml 缺失不能让整个 sidecar 起不来,见 fetcher.py 同样的守卫
    from lxml import html as _lxml_html
except ImportError:  # pragma: no cover - 取决于部署环境
    _lxml_html = None


class ContentDependencyMissing(RuntimeError):
    """正文抓取所需的第三方依赖(lxml / curl_cffi)未安装."""


# 正文容器:精确 token 匹配优先,宽松匹配兜一手
CONTAINER_STRICT = (
    '//div[contains(concat(" ", normalize-space(@class), " "), " article-c ")]'
)
CONTAINER_LOOSE = '//div[contains(@class, "article-c")]'
# 正文本体:article-c 的直接子级 div.info(id=articleInfo)。class "info" 太
# 泛,必须限定在容器直下才敢用,再配 id 双保险。
CONTAINER_INFO = (
    './div[@id="articleInfo" or '
    'contains(concat(" ", normalize-space(@class), " "), " info ")]'
)
# 摘要:article-c 直下的 p.des,内容是编辑写的导语(带 "摘要：/Abstract："
# 一类的语言标签前缀)。
SUMMARY_NODE = './p[contains(concat(" ", normalize-space(@class), " "), " des ")]'

# 这些子树整棵丢掉:脚本、样式、导航骨架
DROP_TAGS = frozenset(
    {
        "script",
        "style",
        "noscript",
        "iframe",
        "form",
        "nav",
        "header",
        "footer",
        "aside",
        "svg",
        "button",
        "select",
        "textarea",
        "template",
    }
)

# 正文容器内按 id 整棵丢掉的子树:mlBox 是目次(标题跳转列表,与后文的
# h2 完全重复,不是正文)
DROP_IDS = frozenset({"mlBox"})

# 块级标签:收尾补空行,避免段落被粘成一坨
BLOCK_TAGS = frozenset(
    {
        "p",
        "div",
        "section",
        "article",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "li",
        "tr",
        "blockquote",
        "pre",
        "td",
        "dd",
        "dt",
        "figcaption",
        "table",
        "ul",
        "ol",
    }
)

# 低于此长度判为「抽取为空」
MIN_CONTENT_CHARS = 200
# 防病态页面把库撑爆
MAX_CONTENT_CHARS = 200_000
# 链接文本占比超过这个值的节点判为导航/菜单区,不是正文
MAX_LINK_DENSITY = 0.5
# 兜底选容器时,持有「最长块 60% 以上文本」的最紧凑节点胜出
FALLBACK_COVERAGE = 0.6

_META_TITLE_XPATHS = (
    '//meta[@property="og:title"]/@content',
    '//meta[@name="og:title"]/@content',
    '//meta[@name="twitter:title"]/@content',
)

_META_IMAGE_XPATHS = (
    '//meta[@property="og:image"]/@content',
    '//meta[@property="og:image:secure_url"]/@content',
    '//meta[@name="og:image"]/@content',
    '//meta[@name="twitter:image"]/@content',
    '//meta[@property="twitter:image"]/@content',
)

_IMAGE_URL_ATTRIBUTES = ("data-src", "data-original", "data-lazy-src", "src")
_MAX_IMAGE_URL_CHARS = 4096

_META_DATE_XPATHS = (
    '//meta[@property="article:published_time"]/@content',
    '//meta[@property="og:release_date"]/@content',
    '//meta[@itemprop="datePublished"]/@content',
    '//meta[@name="pubdate"]/@content',
    '//time/@datetime',
)

# ---- 尾部推广块修剪 ----
# 分隔线:整行只有横线/框线/等号/星号一类装饰字符(≥3 个)。编辑手打的
# "----" "————" "┏━━┓" 都落在这里。
_SEPARATOR_LINE = re.compile(
    r"^[\s\-—–―‐─━┄┅═=＝_＿\*＊·•~～┏┓┗┛┃│┆]+$"
)
# 推广引导行:▶/► 开头("▶ 信頼できるFX業者を探すには?" 一类)
_PROMO_ARROW = re.compile(r"^[▶►▷]")
# App 下载短链行:"Android: cutt.ly/..." / "iOS: ..."
_APP_LINK = re.compile(r"^(?:Android|iOS)\s*[:：]\s*\S+$", re.IGNORECASE)
# 单次修剪最多砍掉全文的这个比例——防止把正文中段的分隔线误当推广起点
_TAIL_TRIM_MAX_FRACTION = 0.25
# 迭代上限。tr 语种那种「分隔线+框+短链」叠了 6 层的尾巴要剪好几刀
_TAIL_TRIM_ROUNDS = 8

_SUMMARY_LABEL = re.compile(r"^[^：]{1,24}：\s*")

_DATE_PREFIX = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")
# 页面标题里的站名后缀:"标题 -أخبار- WikiFX" / "标题 - WikiFX"
_TITLE_SUFFIX_SECTION = re.compile(r"\s*-[^-]{0,20}-\s*WikiFX\s*$")
_TITLE_SUFFIX_PLAIN = re.compile(r"\s*[-|–—]\s*WikiFX\s*$")


@dataclass(frozen=True)
class ExtractedArticle:
    title: Optional[str]
    # p.des 里的编辑导语(已去掉 "摘要：/Abstract：" 语言标签前缀)
    summary: Optional[str]
    # 正文里的首张有效图片；正文无图时退到 og:image / twitter:image
    first_image_url: Optional[str]
    text: str
    chars: int
    # article-info | article-c | article-c-loose | longest-block | ""(未抽到)
    method: str
    published_date: Optional[str]
    # meta | article_id | None,让任何人一眼看出日期是不是推导来的
    published_date_source: Optional[str]


def derive_published_date(article_id: str) -> Optional[str]:
    """从文章 ID 前 8 位推导发布日期(20260724... → 2026-07-24).

    实测 8 篇里 7 篇与页面内抽取的日期完全一致,1 篇差 2 天(疑似创建 vs
    发布之差)。所以这是推导值,调用方要把 source 标成 article_id。
    """
    parsed = article_id_date(article_id)
    # 明显越界的当作巧合数字,不是日期
    if parsed is None or parsed > date.today() + timedelta(days=2):
        return None
    return parsed.isoformat()


def _normalize_ws(text: str) -> str:
    text = text.replace(" ", " ").replace("​", "")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _node_text(node) -> str:
    """把节点转成带段落分隔的纯文本.

    不能直接用 lxml 的 text_content():它会把相邻段落首尾粘死
    ("...上段结束下段开始"),对阅读和喂给模型都是灾难。
    """
    parts: list[str] = []

    def walk(element) -> None:
        tag = element.tag
        # 注释/处理指令的 tag 不是字符串,但它们的 tail 属于父级正文流
        if not isinstance(tag, str):
            if element.tail:
                parts.append(element.tail)
            return

        name = tag.lower()
        if name in DROP_TAGS or (element.get("id") or "") in DROP_IDS:
            if element.tail:
                parts.append(element.tail)
            return

        if name == "br":
            parts.append("\n")
        if element.text:
            parts.append(element.text)
        for child in element:
            walk(child)
        if name in BLOCK_TAGS:
            parts.append("\n\n")
        if element.tail:
            parts.append(element.tail)

    walk(node)
    return _normalize_ws("".join(parts))


def _link_density(node, text_length: int) -> float:
    """链接文本占比。导航栏/菜单几乎全是链接,正文不是。

    这一条是兜底抽取能用的关键:没有它,「最长文本块」几乎必然选中整个
    <body>,把语言切换栏一起卷进来(trafilatura 当初栽的正是这个坑)。
    """
    if text_length <= 0:
        return 1.0
    link_chars = sum(len(anchor.text_content() or "") for anchor in node.iter("a"))
    return link_chars / text_length


def _fallback_longest_block(tree) -> Optional[str]:
    """通用兜底:选「持有大部分正文的最紧凑容器」.

    只取最长的那个节点是不行的——<body> 包含导航 + 正文,总长必然最大,
    而它的链接密度会被长正文稀释到阈值以下,照样入选。所以先按长度筛出
    覆盖率达标的候选,再取其中**最短**的那个:它就是刚好装下正文、又不
    含外层壳子的那一层。
    """
    candidates: list[tuple[int, object]] = []
    for element in tree.iter():
        tag = element.tag
        if not isinstance(tag, str) or tag.lower() not in BLOCK_TAGS:
            continue
        # text_content 是 C 实现,先用它做廉价初筛,别对每个节点都跑完整 walker
        raw_length = len(element.text_content() or "")
        if raw_length < MIN_CONTENT_CHARS:
            continue
        if _link_density(element, raw_length) > MAX_LINK_DENSITY:
            continue
        candidates.append((raw_length, element))

    if not candidates:
        return None

    longest = max(length for length, _ in candidates)
    threshold = longest * FALLBACK_COVERAGE
    tightest = min(
        (item for item in candidates if item[0] >= threshold),
        key=lambda item: item[0],
    )
    text = _node_text(tightest[1])
    return text or None


def _extract_summary(container) -> Optional[str]:
    """从 article-c 直下的 p.des 抽编辑导语.

    前缀是各语言的「摘要」标签("摘要：/Abstract：/概要：/Резюме：..."),
    全部以全角冒号收尾且不超过 24 字符,按此剥掉;正文里出现全角冒号的
    位置远晚于 24 字符,不会误伤。
    """
    nodes = container.xpath(SUMMARY_NODE)
    if len(nodes) != 1:
        return None
    text = _normalize_ws(nodes[0].text_content() or "")
    text = _SUMMARY_LABEL.sub("", text, count=1)
    return text.strip() or None


def _is_promo_marker(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if _PROMO_ARROW.match(stripped) or _APP_LINK.match(stripped):
        return True
    if _SEPARATOR_LINE.match(stripped) and len(re.sub(r"\s", "", stripped)) >= 3:
        return True
    return False


def _trim_promo_tail(text: str) -> str:
    """保守剪掉文末的编辑推广块.

    从全文找「最后一个推广标记行」(分隔线/▶ 引导/App 短链),把它到文末
    整段剪掉,然后重复——tr 语种那种分隔线+框线+短链叠着的尾巴要剪好几刀。
    两条护栏保证保守:单刀不超过全文 25%(正文中段的装饰分隔线因此不会
    误触发),剪完不能短于 MIN_CONTENT_CHARS。没有标记行的推广段(如泰语
    的纯文字引流)宁可留着也不猜。
    """
    for _ in range(_TAIL_TRIM_ROUNDS):
        lines = text.split("\n")
        marker = None
        for i in range(len(lines) - 1, -1, -1):
            if _is_promo_marker(lines[i]):
                marker = i
                break
        if marker is None:
            return text
        kept = "\n".join(lines[:marker]).rstrip()
        if len(text) - len(kept) > len(text) * _TAIL_TRIM_MAX_FRACTION:
            return text
        if len(kept) < MIN_CONTENT_CHARS:
            return text
        text = kept
    return text


def _extract_title(tree) -> Optional[str]:
    for xpath in _META_TITLE_XPATHS:
        values = tree.xpath(xpath)
        if values and values[0].strip():
            return values[0].strip()

    values = tree.xpath("//title/text()")
    if not values:
        return None
    title = values[0].strip()
    title = _TITLE_SUFFIX_SECTION.sub("", title)
    title = _TITLE_SUFFIX_PLAIN.sub("", title)
    return title.strip() or None


def _normalize_image_url(value: str, source_url: str) -> Optional[str]:
    raw = (value or "").strip()
    if not raw or len(raw) > _MAX_IMAGE_URL_CHARS:
        return None
    if raw.startswith("//"):
        raw = "https:" + raw
    elif source_url:
        raw = urljoin(source_url, raw)

    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    if (
        parts.scheme.lower() not in {"http", "https"}
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
    ):
        return None
    return raw


def _extract_first_image_url(
    tree, *, body_node=None, source_url: str = ""
) -> Optional[str]:
    """取文章正文首张有效图，正文没有时再用社交分享图兜底。"""
    nodes = []
    if body_node is not None:
        nodes = body_node.xpath(".//img")
    else:
        exact = tree.xpath('//div[@id="articleInfo"]')
        if len(exact) == 1:
            nodes = exact[0].xpath(".//img")

    for node in nodes:
        for attribute in _IMAGE_URL_ATTRIBUTES:
            normalized = _normalize_image_url(node.get(attribute) or "", source_url)
            if normalized:
                return normalized

    for xpath in _META_IMAGE_XPATHS:
        for value in tree.xpath(xpath):
            normalized = _normalize_image_url(str(value), source_url)
            if normalized:
                return normalized
    return None


def _extract_meta_date(tree) -> Optional[str]:
    for xpath in _META_DATE_XPATHS:
        for value in tree.xpath(xpath):
            match = _DATE_PREFIX.match((value or "").strip())
            if match is None:
                continue
            try:
                parsed = date(
                    int(match.group(1)), int(match.group(2)), int(match.group(3))
                )
            except ValueError:
                continue
            return parsed.isoformat()
    return None


def extract_article(
    html: str, *, article_id: str = "", source_url: str = ""
) -> ExtractedArticle:
    """从文章页 HTML 抽出正文/标题/发布日期。

    永不抛异常(依赖缺失除外):抽不到就返回空文本 + method="",
    让调用方记成 empty 状态并计入批次统计。
    """
    if _lxml_html is None:
        raise ContentDependencyMissing("lxml is not installed")

    empty = ExtractedArticle(
        title=None,
        summary=None,
        first_image_url=None,
        text="",
        chars=0,
        method="",
        published_date=derive_published_date(article_id),
        published_date_source=(
            "article_id" if derive_published_date(article_id) else None
        ),
    )
    if not (html or "").strip():
        return empty

    try:
        tree = _lxml_html.fromstring(html)
    except Exception:
        return empty

    text = ""
    method = ""
    summary = None
    image_root = None
    strict = tree.xpath(CONTAINER_STRICT)
    if len(strict) == 1:
        summary = _extract_summary(strict[0])
        info = strict[0].xpath(CONTAINER_INFO)
        if len(info) == 1:
            image_root = info[0]
            text = _node_text(info[0])
            method = "article-info"
        if len(text) < MIN_CONTENT_CHARS:
            # info 缺席/不唯一/太短:退回整容器。会混进页头页尾,记成
            # article-c 让 by_method 面板看得见这一级的降级。
            if image_root is None:
                image_root = strict[0]
            text = _node_text(strict[0])
            method = "article-c"
    else:
        loose = tree.xpath(CONTAINER_LOOSE)
        if len(loose) == 1:
            image_root = loose[0]
            summary = _extract_summary(loose[0])
            text = _node_text(loose[0])
            method = "article-c-loose"

    if len(text) < MIN_CONTENT_CHARS:
        fallback = _fallback_longest_block(tree)
        if fallback and len(fallback) >= MIN_CONTENT_CHARS:
            text = fallback
            method = "longest-block"
        elif len(text) < MIN_CONTENT_CHARS:
            text = ""
            method = ""

    text = _trim_promo_tail(text)
    if len(text) > MAX_CONTENT_CHARS:
        text = text[:MAX_CONTENT_CHARS]

    meta_date = _extract_meta_date(tree)
    if meta_date:
        published_date, source = meta_date, "meta"
    else:
        published_date = derive_published_date(article_id)
        source = "article_id" if published_date else None

    return ExtractedArticle(
        title=_extract_title(tree),
        summary=summary,
        first_image_url=_extract_first_image_url(
            tree, body_node=image_root, source_url=source_url
        ),
        text=text,
        chars=len(text),
        method=method,
        published_date=published_date,
        published_date_source=source,
    )
