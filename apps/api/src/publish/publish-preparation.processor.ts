import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ContentValidationError } from '../generation/social-post';
import { PrismaService } from '../prisma/prisma.service';
import {
  PublishPrepareJobData,
  QUEUE_PUBLISH_PREPARE,
} from '../queues';
import { NotionMediaChangedError } from '../sources/notion/notion.service';
import { PublishService } from './publish.service';

@Processor(QUEUE_PUBLISH_PREPARE, {
  concurrency: 1,
})
export class PublishPreparationProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publish: PublishService,
  ) {
    super();
  }

  async process(job: Job<PublishPrepareJobData>) {
    try {
      return await this.publish.prepare(
        job.data.contentItemId,
        job.data.publishRevision,
      );
    } catch (error) {
      const message = (error as Error).message;
      if (error instanceof NotionMediaChangedError) {
        await this.prisma.contentItem.updateMany({
          where: {
            id: job.data.contentItemId,
            status: 'PUBLISHING',
            publishRevision: job.data.publishRevision,
          },
          data: {
            status: 'SUPERSEDED',
            forceReview: true,
            lastError: message,
          },
        });
        return;
      }
      if (error instanceof ContentValidationError) {
        await this.prisma.contentItem.updateMany({
          where: {
            id: job.data.contentItemId,
            status: 'PUBLISHING',
            publishRevision: job.data.publishRevision,
          },
          data: { status: 'REVIEW', forceReview: true, lastError: message },
        });
        return;
      }

      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.prisma.contentItem.updateMany({
        where: {
          id: job.data.contentItemId,
          status: 'PUBLISHING',
          publishRevision: job.data.publishRevision,
        },
        data: {
          status: isFinalAttempt ? 'FAILED' : 'PUBLISHING',
          lastError: message,
        },
      });
      throw error;
    }
  }
}
