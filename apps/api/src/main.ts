import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

// 生产启动守卫：缺关键环境变量直接放弃本次启动（非 0 退出，Railway 判定部署失败），
// 避免「ADMIN_API_KEY 未配 → 管理面裸奔」这类危险默认在生产生效。
const REQUIRED_PROD_ENV = [
  'DATABASE_URL',
  'REDIS_URL',
  'ADMIN_API_KEY',
  'INGEST_API_KEYS',
  'POSTIZ_API_URL',
  'POSTIZ_API_KEY',
  'CONSOLE_URL',
  'NOTION_TOKEN',
];

const PLACEHOLDER = /changeme|todo|xxx|TODO_FILL_ME/i;

function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const missing = REQUIRED_PROD_ENV.filter((k) => !process.env[k]);
  if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    missing.push('OPENROUTER_API_KEY 或 ANTHROPIC_API_KEY 二选一');
  }
  if (missing.length) {
    console.error(
      `[boot] 生产环境缺少必填环境变量，启动中止：${missing.join(', ')}`,
    );
    process.exit(1);
  }

  // 非致命但几乎必然导致功能故障的占位值，仅告警
  const placeholders = Object.entries(process.env)
    .filter(([k]) => REQUIRED_PROD_ENV.includes(k))
    .filter(([, v]) => v && PLACEHOLDER.test(v))
    .map(([k]) => k);
  if (placeholders.length) {
    console.warn('[boot] 检测到占位值环境变量（不会阻止启动）：' + placeholders.join(', '));
  }
}

async function bootstrap() {
  assertProductionEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableCors({ origin: process.env.CONSOLE_URL?.split(',') ?? true });
  app.setGlobalPrefix('v1', { exclude: ['healthz'] });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
