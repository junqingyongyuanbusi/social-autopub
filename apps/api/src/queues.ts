// 队列名与任务负载类型的唯一定义处
export const QUEUE_GENERATION = 'generation';
export const QUEUE_PUBLISH = 'publish';

export interface GenerationJobData {
  contentItemId: string;
}

export interface PublishJobData {
  publishJobId: string;
}
