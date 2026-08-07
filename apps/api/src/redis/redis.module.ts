import { Module, Provider } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

// 应用侧共享 Redis 客户端：用于轮询分布式锁、健康检查、任务补偿。
// 与 BullMQ 自身连接（BullModule 基于 REDIS_URL 另建）互不影响。
// 配置倾向「失败快速返回」而非排队/无限重试，避免下游命令无限挂起。
const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: () => {
    const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      connectTimeout: 5_000,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 500, 3_000),
    });
    client.on('error', () => {
      // ioredis 自带重连；错误打日志即可，避免重复堆栈
    });
    return client;
  },
};

@Module({
  providers: [redisProvider],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
