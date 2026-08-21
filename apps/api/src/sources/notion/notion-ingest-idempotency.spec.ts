import assert from 'node:assert/strict';
import test from 'node:test';
import { IngestService } from '../../ingest/ingest.service';
import { NotionService } from './notion.service';

const richText = (value: string) => [{ plain_text: value }];

test('signed URL rotation reuses content while changed bytes create a reviewed version', async () => {
  let currentUrl = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/a.png?sig=one';
  let currentBytes = Buffer.from('same-image');
  let currentBlockId = 'block-one';
  const notion = new NotionService({
    downloadPublicImage: async () => currentBytes,
  } as any);
  (notion as any).resolveSchema = async () => ({
    title: 'Name',
    sent: 'social_media_sent',
  });
  (notion as any).client = {
    blocks: {
      children: {
        list: async () => ({
          results: [
            {
              id: 'paragraph',
              type: 'paragraph',
              paragraph: { rich_text: richText('Body') },
            },
            {
              id: currentBlockId,
              type: 'image',
              last_edited_time: '2026-08-20T00:00:00.000Z',
              image: { file: { url: currentUrl } },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      },
    },
  };

  const rows: any[] = [];
  const queueIds = new Set<string>();
  const prisma = {
    contentItem: {
      findUnique: async ({ where }: any) =>
        rows.find(
          (row) =>
            row.source === where.source_externalId_contentHash.source &&
            row.externalId === where.source_externalId_contentHash.externalId &&
            row.contentHash === where.source_externalId_contentHash.contentHash,
        ) ?? null,
      findMany: async ({ where }: any) =>
        rows
          .filter(
            (row) =>
              row.source === where.source && row.externalId === where.externalId,
          )
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of rows) {
          if (where.id && row.id !== where.id) continue;
          if (where.mediaFingerprint === null && row.mediaFingerprint !== null) continue;
          if (where.status?.in && !where.status.in.includes(row.status)) continue;
          if (where.contentHash?.not && row.contentHash === where.contentHash.not) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
      create: async ({ data }: any) => {
        const row = {
          ...data,
          id: `item-${rows.length + 1}`,
          generationRevision: 0,
          jobs: [],
          createdAt: new Date(rows.length + 1),
        };
        rows.push(row);
        return row;
      },
    },
  };
  const ingest = new IngestService(
    prisma as any,
    {
      add: async (_name: string, _data: unknown, options: { jobId: string }) => {
        queueIds.add(options.jobId);
      },
    } as any,
  );

  const page = {
    id: 'page-1',
    properties: { Name: { title: richText('Title') } },
  };
  const first = await notion.toPayload(page, 'db-1', 'en', 'news');
  assert.ok(first);
  await ingest.upsert('notion', first.payload, {
    rawPayload: first.rawPayload,
    sourceMedia: first.mediaRefs,
  });
  rows[0].status = 'PUBLISHED';
  rows[0].jobs = [{ id: 'sent-job', status: 'sent' }];

  currentUrl = 'https://different-host.example/random-path.png?sig=two';
  currentBlockId = 'block-two';
  const rotated = await notion.toPayload(page, 'db-1', 'en', 'news');
  assert.ok(rotated);
  assert.equal(
    rotated.mediaRefs[0].fingerprintKey,
    first.mediaRefs[0].fingerprintKey,
  );
  await ingest.upsert('notion', rotated.payload, {
    rawPayload: rotated.rawPayload,
    sourceMedia: rotated.mediaRefs,
  });
  assert.equal(rows.length, 1);
  assert.equal(queueIds.size, 1);

  currentBytes = Buffer.from('replacement-image');
  const changed = await notion.toPayload(page, 'db-1', 'en', 'news');
  assert.ok(changed);
  assert.notEqual(
    changed.mediaRefs[0].fingerprintKey,
    first.mediaRefs[0].fingerprintKey,
  );
  await ingest.upsert('notion', changed.payload, {
    rawPayload: changed.rawPayload,
    sourceMedia: changed.mediaRefs,
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].forceReview, true);
});
