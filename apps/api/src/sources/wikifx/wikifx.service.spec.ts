import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { WikifxService } from './wikifx.service';
import { WikifxClientError } from './wikifx.client';

type FetchArticleResult = Promise<{ status: number; data: unknown }>;

function makeService(overrides: Record<string, unknown> = {}) {
  const client: {
    fetchTop: () => Promise<Record<string, unknown>>;
    fetchArticle: (l: string, id: string, o?: { force?: boolean }) => FetchArticleResult;
    resolveArticles: (items: unknown[]) => Promise<unknown[]>;
  } = {
    fetchTop: async () => ({
      data: {
        statistics_start: '2026-08-28',
        statistics_end: '2026-08-30',
        days: 3,
        top: 1,
        property_id: 'p',
        data_quality: { sampled: false, data_loss_from_other_row: false, skipped_rows: 0 },
        items: [],
      },
      metadata: { wikifxCache: null, age: null, requestId: null },
    }),
    fetchArticle: async (): FetchArticleResult => ({ status: 404, data: null }),
    resolveArticles: async () => [],
    ...(overrides.client ?? {}),
  };
  const prisma = overrides.prisma ?? {};
  const ingest = {
    upsertCalls: [] as Array<{ source: string; payload: Record<string, unknown> }>,
    upsert: async (source: string, payload: Record<string, unknown>) => {
      ingest.upsertCalls.push({ source, payload });
      return {
        id: 'item-1',
        status: 'REVIEW',
        createdAt: new Date('2026-08-31T00:00:00Z'),
      };
    },
    ...(overrides.ingest ?? {}),
  };
  const access = {
    assertPermission: async () => undefined,
    visibleLanguages: async () => null,
    ...(overrides.access ?? {}),
  };
  const redis = {
    get: async () => null,
    set: async () => 'OK',
    ...(overrides.redis ?? {}),
  };
  const service = new WikifxService(
    client as any,
    prisma as any,
    ingest as any,
    access as any,
    redis as any,
  );
  return { service, client, ingest, access, redis };
}

const user = { id: 'u1', role: 'admin' } as const;

const detailOk = {
  language: 'ja',
  article_id: '202608202624732011',
  title: 'マネックス証券 GOLD24-7',
  url: 'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
  content: '正文内容',
  first_image_url: 'https://cdn.example.com/a.jpg',
  status: 'ok',
};

test('fetchByUrl rejects untrusted url before any upstream call', async () => {
  const { service, client } = makeService();
  let upstreamHits = 0;
  client.fetchArticle = async () => {
    upstreamHits++;
    return { status: 200, data: detailOk };
  };
  await assert.rejects(
    () =>
      service.fetchByUrl(
        user,
        'https://www.wikifx.com.evil.example/ja/newsdetail/202608202624732011.html',
        false,
      ),
    Error,
  );
  assert.equal(upstreamHits, 0);
});

test('fetchByUrl reads from cache when present and not forced', async () => {
  const cached = {
    language: 'ja',
    article_id: '202608202624732011',
    title: 't',
    url: 'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
    content: '缓存的正文',
    first_image_url: null,
    content_status: 'ok',
    content_message: null,
  };
  const { service, client } = makeService({
    redis: { get: async () => JSON.stringify(cached) },
  });
  let upstreamHits = 0;
  client.fetchArticle = async () => {
    upstreamHits++;
    return { status: 200, data: detailOk };
  };
  const result = await service.fetchByUrl(
    user,
    'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
    false,
  );
  assert.equal(result.origin, 'cache');
  assert.equal(result.article.content, '缓存的正文');
  assert.equal(upstreamHits, 0);
});

test('fetchByUrl does not serve a cached failed content state', async () => {
  const { service, client } = makeService({
    redis: {
      get: async () =>
        JSON.stringify({
          language: 'ja',
          article_id: '202608202624732011',
          title: 'old',
          url: 'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
          content: 'stale body',
          first_image_url: null,
          content_status: 'blocked',
          content_message: 'blocked',
        }),
    },
  });
  client.fetchArticle = async () => ({ status: 404, data: null });
  await assert.rejects(
    () =>
      service.fetchByUrl(
        user,
        'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
        false,
      ),
    UnprocessableEntityException,
  );
});

test('fetchByUrl with force ignores cache and stores upstream result', async () => {
  const cached = {
    language: 'ja',
    article_id: '202608202624732011',
    title: 'old',
    url: '',
    content: '旧缓存',
    first_image_url: null,
    content_status: 'ok',
    content_message: null,
  };
  const writes: unknown[] = [];
  const { service, client } = makeService({
    redis: {
      get: async () => JSON.stringify(cached),
      set: async (_k: string, v: string) => {
        writes.push(v);
        return 'OK';
      },
    },
  });
  client.fetchArticle = async () => ({ status: 200, data: detailOk });
  const result = await service.fetchByUrl(
    user,
    'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
    true,
  );
  assert.equal(result.origin, 'upstream');
  assert.equal(result.article.title, 'マネックス証券 GOLD24-7');
  assert.equal(writes.length, 1);
});

test('fetchByUrl surfaces not-fetched and empty-content states', async () => {
  const notFetched = makeService();
  notFetched.client.fetchArticle = async () => ({ status: 404, data: null });
  await assert.rejects(
    () =>
      notFetched.service.fetchByUrl(
        user,
        'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
        false,
      ),
    (error: unknown) =>
      error instanceof UnprocessableEntityException &&
      /不在正文库中/.test(String(error.message)),
  );

  const empty = makeService();
  empty.client.fetchArticle = async () => ({
    status: 200,
    data: { ...detailOk, content: '  ' },
  });
  await assert.rejects(
    () =>
      empty.service.fetchByUrl(
        user,
        'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
        false,
      ),
    UnprocessableEntityException,
  );
});

test('fetchByUrl rejects a sidecar response for a different article', async () => {
  const { service, client } = makeService();
  client.fetchArticle = async () => ({
    status: 200,
    data: {
      ...detailOk,
      article_id: '202608202624732012',
    },
  });
  await assert.rejects(
    () =>
      service.fetchByUrl(
        user,
        'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
        true,
      ),
    /mismatched article/,
  );
});

test('fetchByUrl maps upstream config and timeout errors', async () => {
  const config = makeService();
  config.client.fetchArticle = async () => {
    throw new WikifxClientError('not configured', undefined, null, 'config');
  };
  await assert.rejects(
    () =>
      config.service.fetchByUrl(
        user,
        'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
        false,
      ),
    /not configured/,
  );
});

test('adopt via manual uses cached content and never accepts browser content', async () => {
  const cached = {
    language: 'ja',
    article_id: '202608202624732011',
    title: '缓存标题',
    url: 'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
    content: '缓存正文',
    first_image_url: null,
    content_status: 'ok',
    content_message: null,
  };
  const { service, ingest } = makeService({
    redis: { get: async () => JSON.stringify(cached) },
  });
  const result = await service.adopt(user, {
    article_id: '202608202624732011',
    language: 'ja',
    manual: true,
  });
  assert.equal(result.status, 'REVIEW');
  assert.equal(ingest.upsertCalls.length, 1);
  const payload = ingest.upsertCalls[0].payload;
  assert.equal(payload.body, '缓存正文');
  assert.equal(payload.title, '缓存标题');
  assert.equal(payload.external_id, 'ja:202608202624732011');
});

test('adopt via manual rejects when cache expired', async () => {
  const { service } = makeService();
  await assert.rejects(
    () =>
      service.adopt(user, {
        article_id: '202608202624732011',
        language: 'ja',
        manual: true,
      }),
    (error: unknown) =>
      error instanceof ConflictException &&
      /手动抓取结果已过期/.test(String(error.message)),
  );
});

test('adopt without manual falls back to trusted topic result', async () => {
  const { service } = makeService({
    client: {
      fetchTop: async () => ({
        data: {
          statistics_start: '2026-08-28',
          statistics_end: '2026-08-30',
          days: 3,
          top: 1,
          property_id: 'p',
          data_quality: { sampled: false, data_loss_from_other_row: false, skipped_rows: 0 },
          items: [
            {
              article_id: '202608202624732011',
              language: 'ja',
              article_url: 'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
              article_title: '榜单标题',
              content: '榜单正文',
              first_image_url: null,
              content_country: null,
              content_region: null,
              view_count: 1,
              active_users: 1,
              avg_engagement_seconds: 1,
              click_count: null,
              read_count: null,
            },
          ],
        },
        metadata: { wikifxCache: null, age: null, requestId: null },
      }),
    },
  });
  const result = await service.adopt(user, {
    article_id: '202608202624732011',
    language: 'ja',
  });
  assert.equal(result.status, 'REVIEW');
});

test('topics enriches missing bodies through the content sidecar and omits confirmed 404s', async () => {
  const resolvedCalls: unknown[] = [];
  const { service } = makeService({
    client: {
      fetchTop: async () => ({
        data: {
          statistics_start: '2026-08-28',
          statistics_end: '2026-08-30',
          days: 3,
          top: 1,
          property_id: 'p',
          data_quality: { sampled: false, data_loss_from_other_row: false, skipped_rows: 0 },
          items: [
            {
              article_id: '202608274774520712',
              language: 'en',
              article_url: 'https://www.wikifx.com/en/newsdetail/202608274774520712.html',
              article_title: 'Tattvam Review',
              content: null,
              first_image_url: null,
              content_country: null,
              content_region: null,
              view_count: 10,
              active_users: 2,
              avg_engagement_seconds: 3,
            },
            {
              article_id: '202608274774520713',
              language: 'en',
              article_url: 'https://www.wikifx.com/en/newsdetail/202608274774520713.html',
              article_title: 'Removed',
              content: null,
              first_image_url: null,
              content_country: null,
              content_region: null,
              view_count: 9,
              active_users: 2,
              avg_engagement_seconds: 3,
            },
          ],
        },
        metadata: { wikifxCache: null, age: null, requestId: null },
      }),
      resolveArticles: async (items: unknown[]) => {
        resolvedCalls.push(items);
        return [
          {
            language: 'en',
            article_id: '202608274774520712',
            title: 'Tattvam Review 2026',
            content: '抓取后的正文',
            first_image_url: 'https://cdn.example.com/cover.jpg',
            status: 'ok',
            content_status: 'fetched',
          },
          {
            language: 'en',
            article_id: '202608274774520713',
            status: 'not_found',
            error_code: 'not_found',
          },
        ];
      },
    },
    prisma: { contentItem: { findMany: async () => [] } },
  });

  const result = await service.topics(user, 3, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].content, '抓取后的正文');
  assert.equal(result.items[0].title, 'Tattvam Review 2026');
  assert.equal(resolvedCalls.length, 1);
});

test('non-manual adoption resolves missing body from the content sidecar', async () => {
  const { service, ingest, client } = makeService({
    client: {
      fetchTop: async () => ({
        data: {
          statistics_start: '2026-08-28',
          statistics_end: '2026-08-30',
          days: 3,
          top: 1,
          property_id: 'p',
          data_quality: { sampled: false, data_loss_from_other_row: false, skipped_rows: 0 },
          items: [
            {
              article_id: '202608274774520712',
              language: 'en',
              article_url: 'https://www.wikifx.com/en/newsdetail/202608274774520712.html',
              article_title: '榜单标题',
              content: null,
              first_image_url: null,
              content_country: null,
              content_region: null,
              view_count: 1,
              active_users: 1,
              avg_engagement_seconds: 1,
            },
          ],
        },
        metadata: { wikifxCache: null, age: null, requestId: null },
      }),
      resolveArticles: async () => [
        {
          language: 'en',
          article_id: '202608274774520712',
          title: 'sidecar title',
          content: 'sidecar body',
          status: 'ok',
          content_status: 'fetched',
        },
      ],
    },
  });
  const result = await service.adopt(user, {
    article_id: '202608274774520712',
    language: 'en',
  });
  assert.equal(result.status, 'REVIEW');
  assert.equal(ingest.upsertCalls[0].payload.body, 'sidecar body');
  assert.equal(typeof client.resolveArticles, 'function');
});

test('manual fetch does not accept preserved stale content when sidecar latest status failed', async () => {
  const { service, client } = makeService();
  client.fetchArticle = async () => ({
    status: 200,
    data: {
      ...detailOk,
      content: '旧正文仍被 sidecar 保留用于诊断',
      status: 'blocked',
      error_code: 'blocked',
    },
  });
  await assert.rejects(
    () =>
      service.fetchByUrl(
        user,
        'https://www.wikifx.com/ja/newsdetail/202608202624732011.html',
        true,
      ),
    (error: unknown) =>
      error instanceof UnprocessableEntityException && /拦截/.test(String(error.message)),
  );
});
