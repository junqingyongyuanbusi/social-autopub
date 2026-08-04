import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableCors({ origin: process.env.CONSOLE_URL?.split(',') ?? true });
  app.setGlobalPrefix('v1', { exclude: ['healthz'] });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
