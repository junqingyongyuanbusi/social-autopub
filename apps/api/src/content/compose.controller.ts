import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { AccessService } from '../common/access.service';
import { CurrentUser, RequestUser } from '../common/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { PublishService } from '../publish/publish.service';

// 手动撰写：运营自己写文案、自己传图、自己选账号后直接发布，
// 不经过 Notion/HTTP/WikiFX 摄取，也不调用 LLM，因此不进入 REVIEW。
const PLATFORMS = ['x', 'instagram', 'facebook'] as const;

// 需要 16:9 横图的平台；Instagram 走 4:5 槽位
const LANDSCAPE_PLATFORMS = ['x', 'facebook'];

interface MediaRef {
  id: string;
  path: string;
}

const mediaRefSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
});

const publishSchema = z.object({
  language: z.string().min(1).max(20),
  text: z.string().trim().min(1).max(20000),
  accounts: z
    .array(
      z.object({
        platform: z.enum(PLATFORMS),
        accountId: z.string().min(1),
      }),
    )
    .min(1),
  media: z
    .object({
      instagram: mediaRefSchema.optional(),
      landscape: mediaRefSchema.optional(),
    })
    .optional(),
  publishAt: z.string().datetime().optional().nullable(),
});

@Controller('compose')
@UseGuards(AdminKeyGuard)
export class ComposeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly publish: PublishService,
  ) {}

  // 撰写页初始化：当前用户可选账号、可选语言与干运行状态
  @Get('options')
  async options(@CurrentUser() user: RequestUser) {
    const visibleIds = await this.access.visibleAccountIds(user);
    if (visibleIds !== null && !visibleIds.length) {
      return { dryRun: this.isDryRun(), accounts: [], languages: [] };
    }
    const accounts = await this.prisma.account.findMany({
      where: {
        status: 'active',
        ...(visibleIds !== null ? { id: { in: visibleIds } } : {}),
      },
      select: {
        id: true,
        name: true,
        platform: true,
        market: true,
        owner: { select: { id: true, name: true } },
      },
      orderBy: [{ platform: 'asc' }, { name: 'asc' }],
    });
    const languages = [
      ...new Set(
        accounts
          .map((account) => account.market)
          .filter((market): market is string => Boolean(market)),
      ),
    ].sort();
    return { dryRun: this.isDryRun(), accounts, languages };
  }

  // 直接发布：一份文案 + 两个尺寸的图 + 选定账号。
  // 不校验字数，超限由 prepare 阶段的 validateForPlatform 兜底并在发布记录页暴露原因。
  @Post('publish')
  async publishNow(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    const parsed = publishSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { language, text, accounts, media, publishAt } = parsed.data;

    const platforms = accounts.map((entry) => entry.platform);
    // Generation 以 contentItemId × platform 唯一，同平台多账号不在本次范围
    if (new Set(platforms).size !== platforms.length) {
      throw new BadRequestException('同一平台只能选择一个账号');
    }

    const resolved = await this.resolveAccounts(user, accounts);
    this.assertMediaRequirements(platforms, media);

    const targets = resolved.map(({ account, platform }) => ({
      platform,
      postizIntegrationId: account.postizIntegrationId,
    }));
    const preparedByPlatform = this.preparedMediaByPlatform(platforms, media);

    const item = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contentItem.create({
        data: {
          source: 'manual',
          externalId: randomUUID(),
          contentHash: createHash('sha256')
            .update(text)
            .digest('hex')
            .slice(0, 16),
          language,
          contentType: 'manual',
          title: this.titleFromText(text),
          body: text,
          media: [],
          targetPlatforms: platforms,
          status: 'APPROVED',
          publishAt: publishAt ? new Date(publishAt) : null,
          targetAccountIds: resolved.map(({ account }) => account.id),
          publishTargets: targets as unknown as Prisma.InputJsonValue,
        },
      });
      for (const platform of platforms) {
        await tx.generation.create({
          data: {
            contentItemId: created.id,
            platform,
            content: text, // 三个平台共用同一份文案
            media: [],
            preparedMedia: (preparedByPlatform.get(platform) ??
              []) as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return created;
    });

    // dispatch 会置为 PUBLISHING 并写入 publishTargets；若入队失败，
    // 内容仍保持 APPROVED + publishTargets，由 recovery 补偿重投
    await this.publish.dispatch(item.id, targets);
    return { contentItemId: item.id, status: 'PUBLISHING', platforms };
  }

  // 校验账号归属、状态与平台一致性；不可见的账号一律按「不存在」处理
  private async resolveAccounts(
    user: RequestUser,
    requested: Array<{ platform: string; accountId: string }>,
  ) {
    const visibleIds = await this.access.visibleAccountIds(user);
    const requestedIds = [...new Set(requested.map((entry) => entry.accountId))];
    const loadableIds =
      visibleIds === null
        ? requestedIds
        : requestedIds.filter((id) => visibleIds.includes(id));
    const accounts = loadableIds.length
      ? await this.prisma.account.findMany({
          where: { id: { in: loadableIds } },
        })
      : [];
    const byId = new Map(accounts.map((account) => [account.id, account]));

    return requested.map((entry) => {
      const account = byId.get(entry.accountId);
      if (!account) throw new BadRequestException('所选账号不存在或未获授权');
      if (account.status !== 'active') {
        throw new BadRequestException(
          `账号「${account.name}」当前失联，请先在账号健康页同步`,
        );
      }
      if (account.platform !== entry.platform) {
        throw new BadRequestException(`账号「${account.name}」与所选平台不匹配`);
      }
      return { account, platform: entry.platform };
    });
  }

  private assertMediaRequirements(
    platforms: string[],
    media: { instagram?: MediaRef; landscape?: MediaRef } | undefined,
  ) {
    if (platforms.includes('instagram') && !media?.instagram) {
      throw new BadRequestException('选择 Instagram 时必须上传 4:5 图片');
    }
    if (
      platforms.some((platform) => LANDSCAPE_PLATFORMS.includes(platform)) &&
      !media?.landscape
    ) {
      throw new BadRequestException('选择 Facebook 或 X 时必须上传 16:9 图片');
    }
  }

  // 4:5 槽位只给 Instagram；16:9 槽位同时给 Facebook 与 X
  private preparedMediaByPlatform(
    platforms: string[],
    media: { instagram?: MediaRef; landscape?: MediaRef } | undefined,
  ) {
    const map = new Map<string, MediaRef[]>();
    for (const platform of platforms) {
      if (platform === 'instagram' && media?.instagram) {
        map.set(platform, [media.instagram]);
      } else if (LANDSCAPE_PLATFORMS.includes(platform) && media?.landscape) {
        map.set(platform, [media.landscape]);
      }
    }
    return map;
  }

  private titleFromText(text: string): string {
    const firstLine =
      text.split('\n').find((line) => line.trim().length > 0) ?? text;
    return firstLine.trim().slice(0, 100);
  }

  private isDryRun(): boolean {
    return process.env.DRY_RUN === 'true';
  }
}
