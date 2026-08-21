ALTER TABLE "ContentItem"
  ADD COLUMN "sourceTableType" TEXT,
  ADD COLUMN "publishLink" TEXT,
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "generationRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "forceReview" BOOLEAN NOT NULL DEFAULT false;
