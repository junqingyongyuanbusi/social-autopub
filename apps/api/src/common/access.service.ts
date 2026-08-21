import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestUser, isAdmin } from './current-user';

export type AccountPermission = 'canEdit' | 'canPublish' | 'canReview';

// 账号级可见性与动作权限解析。
// 可见性链路：user → UserAccount → accounts → routing_rules → languages → contents
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  // null = 不受限（admin / 服务级调用）
  async visibleAccountIds(user: RequestUser): Promise<string[] | null> {
    if (isAdmin(user)) return null;
    const links = await this.prisma.userAccount.findMany({
      where: { userId: user.id },
      select: { accountId: true },
    });
    return links.map((l) => l.accountId);
  }

  async visibleIntegrationIds(user: RequestUser): Promise<string[] | null> {
    const accountIds = await this.visibleAccountIds(user);
    if (accountIds === null) return null;
    if (!accountIds.length) return [];
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: { postizIntegrationId: true },
    });
    return accounts.map((a) => a.postizIntegrationId);
  }

  // 用户可见的内容语言集合（其账号在路由矩阵中覆盖的 language）
  async visibleLanguages(user: RequestUser): Promise<string[] | null> {
    const accountIds = await this.visibleAccountIds(user);
    if (accountIds === null) return null;
    if (!accountIds.length) return [];
    const rules = await this.prisma.routingRule.findMany({
      where: { accountId: { in: accountIds } },
      select: { language: true },
      distinct: ['language'],
    });
    return rules.map((r) => r.language);
  }

  // 校验用户对某语言内容的动作权限：该语言相关账号 ∩ 用户关联账号中任一具备权限位
  async assertPermission(user: RequestUser, language: string, permission: AccountPermission) {
    if (isAdmin(user)) return;
    const link = await this.prisma.userAccount.findFirst({
      where: {
        userId: user.id,
        [permission]: true,
        account: { rules: { some: { language } } },
      },
    });
    if (!link) throw new ForbiddenException(`no ${permission} permission for language ${language}`);
  }

  async assertIntegrationPermission(
    user: RequestUser,
    postizIntegrationId: string,
    permission: AccountPermission,
  ) {
    if (isAdmin(user)) return;
    const link = await this.prisma.userAccount.findFirst({
      where: {
        userId: user.id,
        [permission]: true,
        account: { postizIntegrationId },
      },
    });
    if (!link) {
      throw new ForbiddenException(
        `no ${permission} permission for integration ${postizIntegrationId}`,
      );
    }
  }
}
