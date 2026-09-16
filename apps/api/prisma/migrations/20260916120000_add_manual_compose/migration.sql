ALTER TABLE "ContentItem"
  ADD COLUMN "targetAccountIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "ContentItem"
  ALTER COLUMN "targetAccountIds" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "targetAccountIds" SET NOT NULL;

ALTER TABLE "Generation"
  ADD COLUMN "preparedMedia" JSONB;
