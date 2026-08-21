import { measurePlatformContent } from './social-post';

export function validateForPlatform(
  platform: string,
  content: string,
  hashtagSource = content,
): string[] {
  const problems: string[] = [];
  const hashtagText = hashtagSource.replace(/https?:\/\/\S+/gi, '');
  const hashtags = (hashtagText.match(/#[^\s#]+/g) ?? []).length;

  switch (platform) {
    case 'x':
      if (measurePlatformContent(platform, content) > 280)
        problems.push(
          `超出 X 长度限制（加权 ${measurePlatformContent(platform, content)}/280），请精简`,
        )
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
