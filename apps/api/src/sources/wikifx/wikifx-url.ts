// 可信 WikiFX newsdetail 链接解析：只提取受控的 language/article_id。
// 原始 URL 不会发给上游；真正抓取由服务端按固定 WikiFX 路径拼接，避免 SSRF。
// 规则与 go脚手架 antd-pro articleUrl.ts 保持同口径（白名单 host + 8-32 位数字 ID）。

export const TRUSTED_WIKIFX_HOSTS = new Set([
  'www.wikifx.com',
  'aws-www.wikifx.com',
]);

const ARTICLE_PATH =
  /^\/([a-z]{2,8}(?:-[a-z]{2,8})?)\/newsdetail\/([0-9]{8,32})\.html?$/;

export interface WikiFXUrlTarget {
  language: string;
  articleId: string;
  canonicalUrl: string;
}

export function parseWikiFXArticleUrl(input: string): WikiFXUrlTarget {
  const value = input.trim();
  if (!value) throw new Error('请输入 WikiFX 文章链接');
  if (value.length > 2048) throw new Error('WikiFX 文章链接过长');

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('请输入完整的 WikiFX 文章链接');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    !TRUSTED_WIKIFX_HOSTS.has(hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new Error('仅支持 WikiFX 官方文章链接');
  }

  const matched = ARTICLE_PATH.exec(parsed.pathname);
  if (!matched) {
    throw new Error('链接必须是 WikiFX newsdetail 文章链接');
  }

  const language = matched[1].toLowerCase();
  const articleId = matched[2];
  return {
    language,
    articleId,
    canonicalUrl: `https://www.wikifx.com/${language}/newsdetail/${articleId}.html`,
  };
}
