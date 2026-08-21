import { NestFactory } from "@nestjs/core";
import Redis from "ioredis";
import { REDIS_CLIENT } from "../redis/redis.module";
import { PrismaService } from "../prisma/prisma.service";
import { BackfillExposureReviewModule } from "./backfill-exposure-review.module";
import { NotionPoller } from "../sources/notion/notion.poller";

async function main() {
  const app = await NestFactory.createApplicationContext(BackfillExposureReviewModule, {
    logger: ["error", "warn", "log"],
  });
  const redis = app.get<Redis>(REDIS_CLIENT);
  const prisma = app.get(PrismaService)
  try {
    const report = await app.get(NotionPoller).backfillExposureReviewLinks();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await redis.quit().catch(() => redis.disconnect());
    await prisma.$disconnect()
    await app.close()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
