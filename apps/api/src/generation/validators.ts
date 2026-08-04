// 平台文案的确定性校验：LLM 生成后由代码把关，不合格带反馈重写
// X 字符计权：CJK 及全角按 2 计，上限 280
function xWeightedLength(text: string): number {
  let len = 0;
  for (const ch of text) len += /[ᄀ-｠　-鿿가-힯]/.test(ch) ? 2 : 1;
  return len;
}

export function validateForPlatform(platform: string, content: string): string[] {
  const problems: string[] = [];
  const hashtags = (content.match(/#[^\s#]+/g) ?? []).length;

  switch (platform) {
    case 'x':
      if (xWeightedLength(content) > 280) problems.push(`超出 X 长度限制（加权 ${xWeightedLength(content)}/280），请精简`);
      if (hashtags > 2) problems.push(`hashtag 过多（${hashtags} 个，上限 2）`);
      break;
    case 'instagram':
      if (content.length > 2200) problems.push('超出 Instagram 2200 字符上限');
      if (hashtags > 8) problems.push(`hashtag 过多（${hashtags} 个，上限 8）`);
      break;
    case 'facebook':
      if (content.length > 5000) problems.push('文案过长，Facebook 建议 5000 字符内');
      if (hashtags > 3) problems.push(`hashtag 过多（${hashtags} 个，上限 3）`);
      break;
  }
  return problems;
}
