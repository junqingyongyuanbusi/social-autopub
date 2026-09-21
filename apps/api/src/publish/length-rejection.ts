import { PostizRequestError } from '../postiz/postiz.client';

// X 对超长正文的拒绝信号：code 186 为官方错误码，文案在不同链路上措辞略有差异。
// Postiz 会把平台侧响应透传在 body 里，这里只做保守匹配——命中才降级，避免把
// 其他 4xx（鉴权、媒体、限流）误判成长度问题。
const LENGTH_REJECTION_PATTERNS = [
  /\bcode"?\s*:?\s*186\b/i,
  /needs to be a bit shorter/i,
  /too long/i,
  /exceeds? the .{0,20}(character|length) limit/i,
];

export function isLengthRejection(error: unknown): boolean {
  if (!(error instanceof PostizRequestError)) return false;
  if (error.status < 400 || error.status >= 500) return false;
  return LENGTH_REJECTION_PATTERNS.some((pattern) =>
    pattern.test(error.responseBody),
  );
}
