import { BadRequestException, Body, Controller, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { PrismaService } from '../prisma/prisma.service';

const verifySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

// 密码校验接口：仅供 console 服务端（Auth.js authorize）调用，挂 AdminKeyGuard 防外网爆破
@Controller('auth')
@UseGuards(AdminKeyGuard)
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('verify')
  async verify(@Body() body: unknown) {
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const user = await this.prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user || !(await compare(parsed.data.password, user.passwordHash))) {
      throw new UnauthorizedException('invalid credentials');
    }
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
