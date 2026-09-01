import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWikiFXArticleUrl,
  TRUSTED_WIKIFX_HOSTS,
} from './wikifx-url';

test('trusted hosts are exactly the official WikiFX domains', () => {
  assert.deepEqual(
    [...TRUSTED_WIKIFX_HOSTS].sort(),
    ['aws-www.wikifx.com', 'www.wikifx.com'],
  );
});

test('accepts official http(s) newsdetail links with optional htm', () => {
  const cases = [
    'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
    'http://www.wikifx.com/en/newsdetail/12345678901234567890.htm',
    'https://aws-www.wikifx.com/zh-cn/newsdetail/202608202624732011.html',
  ];
  for (const url of cases) {
    const target = parseWikiFXArticleUrl(url);
    assert.match(target.language, /^[a-z]{2,8}(-[a-z]{2,8})?$/);
    assert.match(target.articleId, /^\d{8,32}$/);
    assert.match(target.canonicalUrl, /^https:\/\/www\.wikifx\.com\//);
  }
});

test('rejects untrusted hosts, credentials, ports, and non-newsdetail paths', () => {
  const cases = [
    '',
    'https://www.wikifx.com.evil.example/ja/newsdetail/202608202624732011.html',
    'https://example.com/ja/newsdetail/202608202624732011.html',
    'https://www.wikifx.com:8443/ja/newsdetail/202608202624732011.html',
    'https://user:pass@www.wikifx.com/ja/newsdetail/202608202624732011.html',
    'ftp://www.wikifx.com/ja/newsdetail/202608202624732011.html',
    'https://www.wikifx.com/ja/other/202608202624732011.html',
    'https://www.wikifx.com/ja/newsdetail/short.html',
    'https://www.wikifx.com/ja/newsdetail/not-a-number.html',
  ];
  for (const url of cases) {
    assert.throws(() => parseWikiFXArticleUrl(url), url);
  }
});

test('rejects oversized input', () => {
  const long =
    'https://www.wikifx.com/ja/newsdetail/202608202624732011.html?' +
    'x'.repeat(2100);
  assert.throws(() => parseWikiFXArticleUrl(long));
});
