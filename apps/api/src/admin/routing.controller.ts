import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { PrismaService } from '../prisma/prisma.service';

const ruleSchema = z.object({
  language: z.string().min(2).max(10),
  contentType: z.string().min(1), // 具体类型或 "*"
  platform: z.enum(['x', 'instagram', 'facebook']),
  accountId: z.string().min(1),
  priority: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
});

// 路由矩阵管理：language × contentType × platform → 账号
@Controller('routing')
@UseGuards(AdminKeyGuard)
export class RoutingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.routingRule.findMany({
      include: { account: true },
      orderBy: [{ language: 'asc' }, { contentType: 'asc' }, { platform: 'asc' }, { priority: 'asc' }],
    });
  }

  @Post()
  create(@Body() body: unknown) {
    const parsed = ruleSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.prisma.routingRule.create({ data: parsed.data });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const parsed = ruleSchema.partial().safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.prisma.routingRule.update({ where: { id }, data: parsed.data });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.routingRule.delete({ where: { id } });
  }
}
