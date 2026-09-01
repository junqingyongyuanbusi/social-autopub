import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

function makeController(overrides: Record<string, unknown> = {}) {
  const prisma = {
    $queryRaw: async () => 1,
    ...(overrides.prisma ?? {}),
  };
  const redis = {
    ping: async () => 'PONG',
    ...(overrides.redis ?? {}),
  };
  const wikifx = {
    checkContentHealth: async () => undefined,
    ...(overrides.wikifx ?? {}),
  };
  return new HealthController(prisma as any, redis as any, wikifx as any);
}

function configureContentEnv() {
  const original = {
    url: process.env.WIKIFX_CONTENT_API_URL,
    key: process.env.WIKIFX_CONTENT_API_KEY,
  };
  process.env.WIKIFX_CONTENT_API_URL = 'http://wikifx-content:8000';
  process.env.WIKIFX_CONTENT_API_KEY = 'test-key';
  return () => {
    if (original.url === undefined) delete process.env.WIKIFX_CONTENT_API_URL;
    else process.env.WIKIFX_CONTENT_API_URL = original.url;
    if (original.key === undefined) delete process.env.WIKIFX_CONTENT_API_KEY;
    else process.env.WIKIFX_CONTENT_API_KEY = original.key;
  };
}

test('health includes the WikiFX content sidecar dependency', async () => {
  const restore = configureContentEnv();
  try {
    const result = await makeController().check();
    assert.equal(result.ok, true);
    assert.deepEqual(result.deps, {
      db: 'ok',
      redis: 'ok',
      wikifx_content: 'ok',
    });
  } finally {
    restore();
  }
});

test('health remains available during a staged rollout before sidecar variables are set', async () => {
  const originalUrl = process.env.WIKIFX_CONTENT_API_URL;
  const originalKey = process.env.WIKIFX_CONTENT_API_KEY;
  delete process.env.WIKIFX_CONTENT_API_URL;
  delete process.env.WIKIFX_CONTENT_API_KEY;
  try {
    const result = await makeController().check();
    assert.equal(result.ok, true);
    assert.equal(result.deps.wikifx_content, 'not_configured');
  } finally {
    if (originalUrl === undefined) delete process.env.WIKIFX_CONTENT_API_URL;
    else process.env.WIKIFX_CONTENT_API_URL = originalUrl;
    if (originalKey === undefined) delete process.env.WIKIFX_CONTENT_API_KEY;
    else process.env.WIKIFX_CONTENT_API_KEY = originalKey;
  }
});

test('health is 503 when the WikiFX content sidecar is unavailable', async () => {
  const restore = configureContentEnv();
  const controller = makeController({
    wikifx: {
      checkContentHealth: async () => {
        throw new Error('offline');
      },
    },
  });
  try {
    await assert.rejects(
      () => controller.check(),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        (error.getResponse() as { deps: { wikifx_content: string } }).deps
          .wikifx_content === 'error: unavailable',
    );
  } finally {
    restore();
  }
});
