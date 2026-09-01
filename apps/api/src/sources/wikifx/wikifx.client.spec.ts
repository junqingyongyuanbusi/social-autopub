import assert from 'node:assert/strict';
import test from 'node:test';
import { WikifxClient } from './wikifx.client';

function withEnv(values: Record<string, string | undefined>) {
  const original = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) {
    original.set(key, process.env[key]);
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return () => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test('fetchTop preserves ranking cache headers while detail uses the sidecar', async () => {
  const originalFetch = global.fetch;
  const restore = withEnv({
    WIKIFX_ARTICLES_API_URL:
      'https://articles-api.chouai.cc.cd/api/v1/public/wikifx/articles/top',
    WIKIFX_ARTICLES_API_KEY: 'top-key',
  });
  try {
    let requestedUrl = '';
    global.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          statistics_start: '2026-08-28',
          statistics_end: '2026-08-30',
          days: 3,
          top: 1,
          property_id: 'p',
          data_quality: {
            sampled: false,
            data_loss_from_other_row: false,
            skipped_rows: 0,
          },
          items: [],
        }),
        {
          status: 200,
          headers: {
            'x-wikifx-cache': 'hit',
            'x-wikifx-cache-age': '12',
            'x-request-id': 'req-1',
          },
        },
      );
    }) as typeof fetch;

    const result = await new WikifxClient().fetchTop(3, 1);
    assert.equal(requestedUrl, `${process.env.WIKIFX_ARTICLES_API_URL}?days=3&top=1`);
    assert.deepEqual(result.metadata, {
      wikifxCache: 'hit',
      age: '12',
      requestId: 'req-1',
    });
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test('fetchArticle reads the internal content sidecar, not the public top URL', async () => {
  const originalFetch = global.fetch;
  const restore = withEnv({
    WIKIFX_ARTICLES_API_URL:
      'https://articles-api.chouai.cc.cd/api/v1/public/wikifx/articles/top',
    WIKIFX_ARTICLES_API_KEY: 'top-key',
    WIKIFX_CONTENT_API_URL: 'http://wikifx-content:8000',
    WIKIFX_CONTENT_API_KEY: 'content-key',
    WIKIFX_CONTENT_ALLOW_INSECURE_HTTP: 'true',
  });
  const calls: Array<{ url: string; method: string; authorization: string }> = [];
  try {
    global.fetch = (async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        authorization: String(
          (init?.headers as Record<string, string> | undefined)?.Authorization,
        ),
      });
      return new Response(
        JSON.stringify({
          language: 'ja',
          article_id: '202608202624732011',
          title: 'Tattvam Review',
          content: '正文',
          status: 'ok',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const result = await new WikifxClient().fetchArticle(
      'ja',
      '202608202624732011',
      { force: true },
    );

    assert.equal(result.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(
      calls[0].url,
      'http://wikifx-content:8000/api/articles/content/ja/202608202624732011/fetch',
    );
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].authorization, 'Bearer content-key');
    assert.equal(
      calls[1].url,
      'http://wikifx-content:8000/api/articles/content/ja/202608202624732011',
    );
    assert.equal(calls[1].method, 'GET');
    assert.equal(calls[1].authorization, 'Bearer content-key');
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test('fetchArticle returns a sidecar 404 as the not-fetched state instead of throwing', async () => {
  const originalFetch = global.fetch;
  const restore = withEnv({
    WIKIFX_CONTENT_API_URL: 'https://content.example.internal',
    WIKIFX_CONTENT_API_KEY: 'test-content-key',
    WIKIFX_CONTENT_ALLOW_INSECURE_HTTP: undefined,
  });
  try {
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

    const result = await new WikifxClient().fetchArticle(
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
    restore();
  }
});

test('fetchArticle rejects plaintext HTTP sidecar URLs unless explicitly enabled', async () => {
  const restore = withEnv({
    WIKIFX_CONTENT_API_URL: 'http://127.0.0.1:8000',
    WIKIFX_CONTENT_API_KEY: 'test-content-key',
    WIKIFX_CONTENT_ALLOW_INSECURE_HTTP: 'false',
  });
  try {
    await assert.rejects(
      () => new WikifxClient().fetchArticle('en', '202608274774520712'),
      (error: unknown) =>
        error instanceof Error && /URL is not allowed/.test(error.message),
    );
  } finally {
    restore();
  }
});

test('resolveArticles sends only validated article keys to the sidecar', async () => {
  const originalFetch = global.fetch;
  const restore = withEnv({
    WIKIFX_CONTENT_API_URL: 'http://wikifx-content:8000/base',
    WIKIFX_CONTENT_API_KEY: 'content-key',
    WIKIFX_CONTENT_ALLOW_INSECURE_HTTP: 'true',
  });
  try {
    let request: { url: string; body: unknown; authorization: string } | null = null;
    global.fetch = (async (input, init) => {
      request = {
        url: String(input),
        body: JSON.parse(String(init?.body)),
        authorization: String(
          (init?.headers as Record<string, string> | undefined)?.Authorization,
        ),
      };
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;

    const rows = await new WikifxClient().resolveArticles([
      {
        language: 'en',
        article_id: '202608274774520712',
        article_url:
          'https://aws-www.wikifx.com/en/newsdetail/202608274774520712.htm',
      },
      {
        language: 'en',
        article_id: 'not-an-id',
        article_url: 'https://evil.example/en/newsdetail/not-an-id.html',
      },
    ]);

    assert.deepEqual(rows, []);
    const captured = request!;
    assert.equal(captured.url, 'http://wikifx-content:8000/base/api/articles/content/resolve');
    assert.deepEqual(captured.body, {
      items: [
        {
          language: 'en',
          article_id: '202608274774520712',
          article_url:
            'https://www.wikifx.com/en/newsdetail/202608274774520712.html',
        },
      ],
    });
    assert.equal(captured.authorization, 'Bearer content-key');
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});
