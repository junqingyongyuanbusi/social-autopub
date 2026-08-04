import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// 路由矩阵解析：language × contentType × platform → 账号（支持 "*" 通配与 priority 容灾）
@Injectable()
export class RoutingService {
  constructor(private readonly prisma: PrismaService) {}

  // 该语言×类型下已配置路由的平台集合（内容未指定目标平台时的默认值）
  async platformsFor(language: string, contentType: string): Promise<string[]> {
    const rules = await this.prisma.routingRule.findMany({
      where: { language, contentType: { in: [contentType, '*'] }, enabled: true },
      select: { platform: true },
      distinct: ['platform'],
    });
    return rules.map((r) => r.platform);
  }

  // 解析某平台应发布到的账号：具体类型规则优先于通配，priority 小者优先，剔除失联账号
  async resolveAccounts(language: string, contentType: string, platform: string) {
    const rules = await this.prisma.routingRule.findMany({
      where: { language, contentType: { in: [contentType, '*'] }, platform, enabled: true },
      include: { account: true },
      orderBy: [{ priority: 'asc' }],
    });
    const exact = rules.filter((r) => r.contentType === contentType);
    const active = (exact.length ? exact : rules).filter((r) => r.account.status === 'active');
    return active.map((r) => r.account);
  }
}
