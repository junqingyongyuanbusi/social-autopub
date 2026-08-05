import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { AdminRoleGuard } from '../common/admin-role.guard';
import { PrismaService } from '../prisma/prisma.service';

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(50),
  password: z.string().min(8),
  role: z.enum(['admin', 'operator']).default('operator'),
});
const updateSchema = createSchema.partial().omit({ email: true });

const PUBLIC_FIELDS = { id: true, email: true, name: true, role: true, createdAt: true } as const;

// 控制台用户管理（仅 admin，不返回 passwordHash）
@Controller('users')
@UseGuards(AdminKeyGuard, AdminRoleGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.user.findMany({ select: PUBLIC_FIELDS, orderBy: { createdAt: 'asc' } });
  }

  @Post()
  async create(@Body() body: unknown) {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { password, email, ...rest } = parsed.data;
    const exists = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (exists) throw new BadRequestException('该邮箱已存在');
    return this.prisma.user.create({
      data: { ...rest, email: email.toLowerCase(), passwordHash: await hash(password, 10) },
      select: PUBLIC_FIELDS,
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { password, ...rest } = parsed.data;
    return this.prisma.user.update({
      where: { id },
      data: { ...rest, ...(password ? { passwordHash: await hash(password, 10) } : {}) },
      select: PUBLIC_FIELDS,
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();
    if (user.role === 'admin') {
      const admins = await this.prisma.user.count({ where: { role: 'admin' } });
      if (admins <= 1) throw new BadRequestException('不能删除最后一个管理员');
    }
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}
