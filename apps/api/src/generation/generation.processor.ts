import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_GENERATION, GenerationJobData } from '../queues';
import { GenerationService } from './generation.service';

@Processor(QUEUE_GENERATION, { concurrency: 2 })
export class GenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(GenerationProcessor.name);

  constructor(private readonly generation: GenerationService) {
    super();
  }

  async process(job: Job<GenerationJobData>) {
    try {
      await this.generation.generateFor(
        job.data.contentItemId,
        job.data.forceReview ?? false,
        job.data.generationRevision
      )
    } catch (e) {
      this.logger.error(`generation failed for ${job.data.contentItemId}: ${(e as Error).message}`);
      // 最后一次重试仍失败 → 内容判 FAILED，不再停留在 GENERATING
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (finalAttempt) {
        await this.generation.markFailed(
          job.data.contentItemId,
          (e as Error).message,
          job.data.generationRevision,
        )
      } else {
        // BullMQ 重试会重新执行同一个 job；释放领取状态，允许下一次重新生成。
        await this.generation.releaseForRetry(
          job.data.contentItemId,
          job.data.generationRevision,
        )
      }
      throw e; // 交给 BullMQ 重试
    }
  }
}
