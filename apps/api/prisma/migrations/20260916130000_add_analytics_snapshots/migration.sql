-- CreateTable AccountMetricSnapshot: Postiz 集成级 analytics 的账号 × 指标 × 日期快照
CREATE TABLE "AccountMetricSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable PostMetricSnapshot: 帖子级 analytics 快照，关联 PublishJob
CREATE TABLE "PostMetricSnapshot" (
    "id" TEXT NOT NULL,
    "publishJobId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountMetricSnapshot_accountId_metric_date_key" ON "AccountMetricSnapshot"("accountId", "metric", "date");
CREATE INDEX "AccountMetricSnapshot_accountId_date_idx" ON "AccountMetricSnapshot"("accountId", "date");

CREATE UNIQUE INDEX "PostMetricSnapshot_publishJobId_metric_date_key" ON "PostMetricSnapshot"("publishJobId", "metric", "date");
CREATE INDEX "PostMetricSnapshot_publishJobId_date_idx" ON "PostMetricSnapshot"("publishJobId", "date");

-- AddForeignKey
ALTER TABLE "AccountMetricSnapshot" ADD CONSTRAINT "AccountMetricSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostMetricSnapshot" ADD CONSTRAINT "PostMetricSnapshot_publishJobId_fkey" FOREIGN KEY ("publishJobId") REFERENCES "PublishJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
