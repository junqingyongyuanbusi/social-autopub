import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

@Injectable()
export class PostizRateGate {
  private readonly limit = Math.max(
    1,
    Number(process.env.POSTIZ_API_LIMIT ?? 30) || 30,
  );

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async acquire(): Promise<void> {
    const window = Math.floor(Date.now() / 3_600_000);
    const key = `rate:postiz:${window}`;
    const result = (await this.redis.eval(
      `
        local count = redis.call('incr', KEYS[1])
        if count == 1 then redis.call('expire', KEYS[1], ARGV[2]) end
        if count > tonumber(ARGV[1]) then return redis.call('ttl', KEYS[1]) end
        return 0
      `,
      1,
      key,
      this.limit,
      3_700,
    )) as number;
    if (result <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(result, 60) * 1_000));
    return this.acquire();
  }
}
