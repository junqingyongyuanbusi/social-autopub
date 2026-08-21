import assert from 'node:assert/strict';
import test from 'node:test';
import { PostizClient } from './postiz.client';

test('Postiz uploads and post creation consume the same rate gate', async () => {
  let acquired = 0;
  let fetched = 0;
  const originalFetch = global.fetch;
  global.fetch = (async (input: string | URL | Request) => {
    fetched++;
    const url = String(input);
    return new Response(
      JSON.stringify(url.endsWith('/posts') ? [{ postId: 'post-1' }] : { id: 'media-1', path: '/media/1' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  try {
    const client = new PostizClient(
      {
        downloadPublicImage: async () => Buffer.from('image'),
        createPublishVariant: async () => ({ buffer: Buffer.from('variant') }),
        createPublishVariantFromBuffer: async () => ({ buffer: Buffer.from('variant') }),
      } as any,
      { acquire: async () => { acquired++; } } as any,
    );

    await client.prepareMedia('facebook', [
      { url: 'https://example.com/source.jpg', buffer: Buffer.from('verified') },
      'https://example.com/manual.jpg',
    ]);
    await client.createPost({
      integrationId: 'integration-1',
      platform: 'facebook',
      content: 'content',
      preparedMedia: [],
      dryRun: true,
    });

    assert.equal(acquired, 3);
    assert.equal(fetched, 3);
  } finally {
    global.fetch = originalFetch;
  }
});
