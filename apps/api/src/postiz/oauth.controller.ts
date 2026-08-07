import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Body, Controller, Logger, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { CurrentUser, RequestUser } from '../common/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { AccountSyncService } from './account-sync.service';

const startSchema = z.object({ provider: z.enum(['x', 'instagram', 'facebook']) });

// Postiz enterprise 白标授权用 HS256 JWT（密钥 = Postiz 实例的 JWT_SECRET），手搓避免引依赖
function signJwt(payload: object, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token: string, secret: string): Record<string, unknown> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('malformed token');
  const expect = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const actual = Buffer.from(s, 'base64url');
  if (actual.length !== expect.length || !timingSafeEqual(actual, expect)) throw new Error('bad signature');
  return JSON.parse(Buffer.from(p, 'base64url').toString());
}

// 白标 OAuth 授权流：任何登录用户可发起绑定；授权完成后新账号自动授权给发起人。
// 发起人身份通过我方签名的 binder token 随 webhookUrl 往返，防伪造
@Controller('postiz-oauth')
export class PostizOauthController {
  private readonly logger = new Logger(PostizOauthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: AccountSyncService,
  ) {}

  @Post('start')
  @UseGuards(AdminKeyGuard)
  async start(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    const parsed = startSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const secret = process.env.POSTIZ_JWT_SECRET;
    if (!secret) throw new BadRequestException('POSTIZ_JWT_SECRET 未配置');

    const apiBase = (process.env.POSTIZ_API_URL ?? '').replace(/\/public\/v1\/?$/, '');
    const consoleUrl = (process.env.CONSOLE_URL ?? '').split(',')[0];
    // 本服务公网回拨地址：Docker/自托管用 PUBLIC_API_URL；兼容 Railway 旧变量，最后保底 localhost
    const selfUrl = (
      process.env.PUBLIC_API_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : `http://localhost:${process.env.PORT ?? 3000}`)
    ).replace(/\/+$/, '');

    // 发起人随 webhook 回传（服务级直调无用户身份时不绑定个人）
    const binder = user.id ? `?b=${signJwt({ uid: user.id }, secret)}` : '';

    const token = signJwt(
      {
        redirectUrl: `${consoleUrl}/accounts?connected=1`,
        apiKey: process.env.POSTIZ_API_KEY,
        provider: parsed.data.provider,
        webhookUrl: `${selfUrl}/v1/postiz-oauth/webhook${binder}`,
      },
      secret,
    );

    const res = await fetch(`${apiBase}/enterprise/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'social-autopub/1.0' },
      body: JSON.stringify({ params: token }),
    });
    const url = (await res.text()).trim().replace(/^"|"$/g, '');
    if (!res.ok || !url.startsWith('http')) {
      this.logger.error(`enterprise/url failed: ${res.status} ${url.slice(0, 200)}`);
      throw new BadRequestException('Postiz 授权链接生成失败');
    }
    return { url };
  }

  // Postiz 授权完成回调（公网无守卫路径，靠 JWT 验签 + apiKey 匹配鉴权）。
  // 同步前后 diff 出本次新增账号，自动授权给发起人并设为负责人
  @Post('webhook')
  async webhook(@Body() body: { params?: string }, @Query('b') binderToken?: string) {
    const secret = process.env.POSTIZ_JWT_SECRET;
    if (!secret || !body?.params) throw new UnauthorizedException();
    let payload: Record<string, unknown>;
    try {
      payload = verifyJwt(body.params, secret);
    } catch {
      throw new UnauthorizedException();
    }
    if (payload.apiKey !== process.env.POSTIZ_API_KEY) throw new UnauthorizedException();

    let binderId = '';
    if (binderToken) {
      try {
        binderId = String(verifyJwt(binderToken, secret).uid ?? '');
      } catch {
        this.logger.warn('binder token invalid, skip personal grant');
      }
    }

    const before = new Set(
      (await this.prisma.account.findMany({ select: { id: true } })).map((a) => a.id),
    );
    await this.sync.sync().catch((e) => this.logger.error(`sync after oauth failed: ${e.message}`));
    const after = await this.prisma.account.findMany({ select: { id: true, name: true } });
    const created = after.filter((a) => !before.has(a.id));

    if (binderId && created.length) {
      const binderExists = await this.prisma.user.findUnique({ where: { id: binderId } });
      if (binderExists) {
        for (const account of created) {
          await this.prisma.userAccount.upsert({
            where: { userId_accountId: { userId: binderId, accountId: account.id } },
            create: { userId: binderId, accountId: account.id },
            update: {},
          });
          await this.prisma.account.update({
            where: { id: account.id },
            data: { ownerId: binderId },
          });
        }
        this.logger.log(`granted ${created.length} new account(s) to binder ${binderExists.email}`);
      }
    }
    return { ok: true, newAccounts: created.length };
  }
}
