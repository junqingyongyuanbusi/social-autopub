UPDATE "ContentItem"
SET "targetPlatforms" = ARRAY[]::TEXT[]
WHERE "targetPlatforms" IS NULL;

ALTER TABLE "ContentItem"
  ALTER COLUMN "targetPlatforms" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "targetPlatforms" SET NOT NULL;

ALTER TABLE "ContentItem"
  ADD COLUMN "mediaFingerprint" TEXT,
  ADD COLUMN "publishRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "publishTargets" JSONB;

ALTER TABLE "PublishJob"
  ADD COLUMN "mediaSnapshot" JSONB,
  ADD COLUMN "publishRevision" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "PublishJob_contentItemId_publishRevision_platform_postizIntegrationId_key"
  ON "PublishJob"("contentItemId", "publishRevision", "platform", "postizIntegrationId");

CREATE TABLE "NotionIngestFailure" (
  "id" TEXT NOT NULL,
  "sourceDatabaseId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "error" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotionIngestFailure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotionIngestFailure_sourceDatabaseId_pageId_key"
  ON "NotionIngestFailure"("sourceDatabaseId", "pageId");
CREATE INDEX "NotionIngestFailure_updatedAt_idx"
  ON "NotionIngestFailure"("updatedAt");
ALTER TABLE "NotionIngestFailure"
  ADD CONSTRAINT "NotionIngestFailure_sourceDatabaseId_fkey"
  FOREIGN KEY ("sourceDatabaseId") REFERENCES "SourceDatabase"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
