// 队列名与任务负载类型的唯一定义处
export const QUEUE_GENERATION = 'generation';
export const QUEUE_PUBLISH = 'publish';
export const QUEUE_PUBLISH_PREPARE = 'publish-prepare';

export interface GenerationJobData {
  contentItemId: string;
  forceReview?: boolean;
  generationRevision?: number
}

export interface PublishPrepareJobData {
  contentItemId: string;
  publishRevision: number;
}

export interface PublishJobData {
  publishJobId: string;
}
