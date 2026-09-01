import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { withTimeout } from '../common/with-timeout';
import { WikifxClient, WikifxClientError } from '../sources/wikifx/wikifx.client';

// 健康检查：除进程存活外，验证关键依赖（Postgres / Redis）真实可用，
// 任一失败返回 503，避免负载均衡/探针误判「假健康」
@Controller('healthz')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly wikifx: WikifxClient,
  ) {}

  @Get()
  async check() {
    const deps: Record<string, string> = {};
    let ok = true;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      deps.db = 'ok';
    } catch (e) {
      ok = false;
      deps.db = `error: ${(e as Error).message}`;
    }

    try {
      await withTimeout(this.redis.ping(), 3_000);
      deps.redis = 'ok';
    } catch (e) {
      ok = false;
      deps.redis = `error: ${(e as Error).message}`;
    }

    // WikiFX is an optional source for the rest of the application.  During a
    // staged rollout, let the API stay healthy before the sidecar variables
    // are added; once configured, make the private sidecar a real dependency.
    const contentConfigured = Boolean(
      process.env.WIKIFX_CONTENT_API_URL &&
        process.env.WIKIFX_CONTENT_API_KEY,
    );
    if (!contentConfigured) {
      deps.wikifx_content = 'not_configured';
    } else {
      try {
        await this.wikifx.checkContentHealth();
        deps.wikifx_content = 'ok';
      } catch (e) {
        ok = false;
        const message =
          e instanceof WikifxClientError && e.kind === 'config'
            ? 'not_configured'
            : 'unavailable';
        deps.wikifx_content = `error: ${message}`;
      }
    }

    if (!ok) {
      throw new ServiceUnavailableException({
        ok: false,
        ts: new Date().toISOString(),
        deps,
      });
    }
    return { ok: true, ts: new Date().toISOString(), deps };
  }
}
