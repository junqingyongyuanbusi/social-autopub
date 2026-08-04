import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { PrismaService } from '../prisma/prisma.service';
import { NotionPoller } from '../sources/notion/notion.poller';

const sourceSchema = z.object({
  notionDatabaseId: z.string().min(10),
  language: z.string().min(2).max(10),
  tableType: z.string().min(1),
  enabled: z.boolean().default(true),
});

// Notion 数据源注册表管理（设置页数据源，避免直接操作数据库）
@Controller('sources')
@UseGuards(AdminKeyGuard)
export class SourcesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly poller: NotionPoller,
  ) {}

  // 手动触发一轮 Notion 轮询（诊断/首次接入用），返回各表拾取数量
  @Post('poll')
  pollNow() {
    return this.poller.poll();
  }

  @Get()
  list() {
    return this.prisma.sourceDatabase.findMany({ orderBy: [{ language: 'asc' }, { tableType: 'asc' }] });
  }

  @Post()
  create(@Body() body: unknown) {
    const parsed = sourceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.prisma.sourceDatabase.create({ data: parsed.data });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const parsed = sourceSchema.partial().safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.prisma.sourceDatabase.update({ where: { id }, data: parsed.data });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.sourceDatabase.delete({ where: { id } });
  }
}
