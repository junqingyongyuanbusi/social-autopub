import assert from 'node:assert/strict';
import test from 'node:test';
import { WikifxClient } from './wikifx.client';

function makeClient() {
  return new WikifxClient();
}

test('fetchArticle returns 404 as not-fetched state instead of throwing', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.WIKIFX_ARTICLES_API_URL;
  const originalKey = process.env.WIKIFX_ARTICLES_API_KEY;
  const originalCustom = process.env.WIKIFX_ALLOW_CUSTOM_URL;
  try {
    process.env.WIKIFX_ARTICLES_API_URL =
      'https://articles-api.chouai.cc.cd/api/v1/public/wikifx/articles/top';
    process.env.WIKIFX_ARTICLES_API_KEY = 'test-key';
    process.env.WIKIFX_ALLOW_CUSTOM_URL = 'false';
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          detail: {
            code: 'content_not_fetched',
            message: 'Article content has not been fetched',
          },
        }),
        { status: 404 },
      )) as typeof fetch;

    const result = await makeClient().fetchArticle(
      'ja',
      '202608202624732011',
    );

    assert.equal(result.status, 404);
    assert.deepEqual(result.data, {
      detail: {
        code: 'content_not_fetched',
        message: 'Article content has not been fetched',
      },
    });
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.WIKIFX_ARTICLES_API_URL;
    else process.env.WIKIFX_ARTICLES_API_URL = originalUrl;
    if (originalKey === undefined) delete process.env.WIKIFX_ARTICLES_API_KEY;
    else process.env.WIKIFX_ARTICLES_API_KEY = originalKey;
    if (originalCustom === undefined) delete process.env.WIKIFX_ALLOW_CUSTOM_URL;
    else process.env.WIKIFX_ALLOW_CUSTOM_URL = originalCustom;
  }
});
