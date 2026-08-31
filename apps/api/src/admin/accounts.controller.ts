import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { AdminRoleGuard } from '../common/admin-role.guard';
import { AccessService } from '../common/access.service';
import { CurrentUser, RequestUser } from '../common/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { AccountSyncService } from '../postiz/account-sync.service';

const accountPatchSchema = z.object({
  market: z.string().max(20).nullable().optional(),
  ownerId: z.string().nullable().optional(),
  note: z.string().max(200).nullable().optional(),
});

const assignSchema = z.object({
  links: z.array(
    z.object({
      userId: z.string().min(1),
      canEdit: z.boolean().default(true),
      canPublish: z.boolean().default(true),
      canReview: z.boolean().default(true),
    }),
  ),
});

// 账号台账：非 admin 只能看到被分配的账号；台账编辑与用户分配仅 admin
@Controller('accounts')
@UseGuards(AdminKeyGuard)
export class AccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly sync: AccountSyncService,
  ) {}

  @Get()
  async list(@CurrentUser() user: RequestUser) {
    const visibleIds = await this.access.visibleAccountIds(user);
    if (visibleIds !== null && !visibleIds.length) return [];
    return this.prisma.account.findMany({
      where: visibleIds !== null ? { id: { in: visibleIds } } : {},
      include: {
        owner: { select: { id: true, name: true } },
        userLinks: { include: { user: { select: { id: true, name: true } } } },
      },
      orderBy: [{ platform: 'asc' }, { name: 'asc' }],
    });
  }

  @Post('sync')
  @UseGuards(AdminRoleGuard)
  async syncNow(@CurrentUser() user: RequestUser) {
    await this.sync.sync();
    return this.list(user);
  }

  // 台账信息：市场 / 负责人 / 备注（仅 admin）
  @Patch(':id')
  @UseGuards(AdminRoleGuard)
  async update(@Param('id') id: string, @Body() body: unknown) {
    const parsed = accountPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.prisma.account.update({ where: { id }, data: parsed.data });
  }

  // 删除失联账号（仅 admin）：仅允许清理已与 Postiz 失联的台账行；
  // 路由规则一并删除，用户授权走 UserAccount onDelete 级联，PublishJob 仅存 integrationId 字符串不受影响
  @Delete(':id')
  @UseGuards(AdminRoleGuard)
  async remove(@Param('id') id: string) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException();
    if (account.status !== 'disconnected') {
      throw new BadRequestException('仅允许删除失联账号');
    }
    await this.prisma.$transaction([
      this.prisma.routingRule.deleteMany({ where: { accountId: id } }),
      this.prisma.account.delete({ where: { id } }),
    ]);
    return { ok: true };
  }
  // 全量覆盖某账号的用户授权（仅 admin）
  @Put(':id/users')
  @UseGuards(AdminRoleGuard)
  async assignUsers(@Param('id') id: string, @Body() body: unknown) {
    const parsed = assignSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException();

    await this.prisma.$transaction([
      this.prisma.userAccount.deleteMany({ where: { accountId: id } }),
      ...parsed.data.links.map((link) =>
        this.prisma.userAccount.create({ data: { accountId: id, ...link } }),
      ),
    ]);
    return this.prisma.userAccount.findMany({
      where: { accountId: id },
      include: { user: { select: { id: true, name: true } } },
    });
  }
}
