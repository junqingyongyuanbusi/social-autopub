import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthController } from './health/health.controller';
import { IngestModule } from './ingest/ingest.module';
import { NotionModule } from './sources/notion/notion.module';
import { WikifxModule } from './sources/wikifx/wikifx.module';
import { GenerationModule } from './generation/generation.module';
import { PublishModule } from './publish/publish.module';
import { ContentModule } from './content/content.module';
import { PostizModule } from './postiz/postiz.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: false,
        redact: {
          paths: [
            'req.headers["x-admin-key"]',
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
      },
    }),
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: { url: process.env.REDIS_URL },
    }),
    PrismaModule,
    RedisModule,
    CommonModule,
    PostizModule,
    IngestModule,
    NotionModule,
    WikifxModule,
    GenerationModule,
    PublishModule,
    ContentModule,
    AdminModule,
    AuthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
