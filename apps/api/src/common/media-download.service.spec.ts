import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { MediaDownloadService } from './media-download.service';

test('pinned downloader handles Node lookup all=true and returns image bytes', async () => {
  const body = Buffer.from('png-like-test-bytes');
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': body.length,
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const service = new MediaDownloadService();
  (service as any).resolvePublicAddresses = async () => [
    { address: '127.0.0.2', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ];

  try {
    const result = await service.downloadPublicImage(
      `http://example.test:${address.port}/image.png`,
    );
    assert.deepEqual(result, body);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
