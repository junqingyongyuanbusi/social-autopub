from __future__ import annotations

from app.articles.extract import extract_article


def test_extracts_article_info_summary_and_first_image() -> None:
    body = "这是 WikiFX 正文段落，用于验证正文抽取和段落边界。" * 30
    html = f"""
    <html>
      <head>
        <title>Fallback title - WikiFX</title>
        <meta property="og:title" content="真实文章标题" />
      </head>
      <body>
        <div class="article-c">
          <p class="des">摘要：这是编辑导语</p>
          <div id="articleInfo" class="info">
            <p>{body}</p>
            <img data-src="/uploads/cover.jpg" />
          </div>
          <nav>不要把导航混进正文</nav>
        </div>
      </body>
    </html>
    """

    result = extract_article(
        html,
        article_id="202001010000000001",
        source_url="https://www.wikifx.com/en/newsdetail/202001010000000001.html",
    )

    assert result.method == "article-info"
    assert result.title == "真实文章标题"
    assert result.summary == "这是编辑导语"
    assert result.first_image_url == "https://www.wikifx.com/uploads/cover.jpg"
    assert result.text.startswith("这是 WikiFX 正文段落")
    assert "不要把导航混进正文" not in result.text
    assert result.chars == len(result.text)
    assert result.published_date == "2020-01-01"
    assert result.published_date_source == "article_id"


def test_empty_or_unrecognised_markup_is_a_structured_empty_result() -> None:
    result = extract_article("<html><body><nav>menu</nav></body></html>", article_id="bad")
    assert result.text == ""
    assert result.chars == 0
    assert result.method == ""
