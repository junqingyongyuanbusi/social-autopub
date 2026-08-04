import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_PUBLISH, PublishJobData } from '../queues';
import { RoutingService } from './routing.service';

// 审核通过后：按路由矩阵把内容拆成发布子任务入队
@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: RoutingService,
    @InjectQueue(QUEUE_PUBLISH) private readonly publishQueue: Queue<PublishJobData>,
  ) {}

  async dispatch(contentItemId: string) {
    const item = await this.prisma.contentItem.findUniqueOrThrow({
      where: { id: contentItemId },
      include: { generations: true },
    });

    let dispatched = 0;
    for (const gen of item.generations) {
      const accounts = await this.routing.resolveAccounts(item.language, item.contentType, gen.platform);
      if (!accounts.length) {
        this.logger.warn(`no account for ${item.language}/${item.contentType}/${gen.platform}, item ${item.id}`);
        continue;
      }
      // priority 最高的一个账号发布；多账号齐发的规则用多行 routing_rule 同 priority 表达（P2 再放开）
      const account = accounts[0];
      const job = await this.prisma.publishJob.create({
        data: {
          contentItemId: item.id,
          platform: gen.platform,
          postizIntegrationId: account.postizIntegrationId,
          scheduledAt: item.publishAt,
        },
      });
      await this.publishQueue.add('publish', { publishJobId: job.id }, { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } });
      dispatched++;
    }

    await this.prisma.contentItem.update({
      where: { id: item.id },
      data: { status: dispatched ? 'PUBLISHING' : 'FAILED' },
    });
    return dispatched;
  }
}
