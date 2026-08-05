import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Body, Controller, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { AdminRoleGuard } from '../common/admin-role.guard';
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

// 白标 OAuth 授权流：控制台发起 → 平台授权 → Postiz 完成连接 → webhook 通知本服务 → 跳回控制台
@Controller('postiz-oauth')
export class PostizOauthController {
  private readonly logger = new Logger(PostizOauthController.name);

  constructor(private readonly sync: AccountSyncService) {}

  // 生成平台授权链接（仅 admin 发起绑定）
  @Post('start')
  @UseGuards(AdminKeyGuard, AdminRoleGuard)
  async start(@Body() body: unknown) {
    const parsed = startSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const secret = process.env.POSTIZ_JWT_SECRET;
    if (!secret) throw new BadRequestException('POSTIZ_JWT_SECRET 未配置');

    const apiBase = (process.env.POSTIZ_API_URL ?? '').replace(/\/public\/v1\/?$/, '');
    const consoleUrl = (process.env.CONSOLE_URL ?? '').split(',')[0];
    const selfUrl = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : `http://localhost:${process.env.PORT ?? 3000}`;

    const token = signJwt(
      {
        redirectUrl: `${consoleUrl}/accounts?connected=1`,
        apiKey: process.env.POSTIZ_API_KEY,
        provider: parsed.data.provider,
        webhookUrl: `${selfUrl}/v1/postiz-oauth/webhook`,
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

  // Postiz 授权完成回调（公网无守卫路径，靠 JWT 验签 + apiKey 匹配鉴权）
  @Post('webhook')
  async webhook(@Body() body: { params?: string }) {
    const secret = process.env.POSTIZ_JWT_SECRET;
    if (!secret || !body?.params) throw new UnauthorizedException();
    let payload: Record<string, unknown>;
    try {
      payload = verifyJwt(body.params, secret);
    } catch {
      throw new UnauthorizedException();
    }
    if (payload.apiKey !== process.env.POSTIZ_API_KEY) throw new UnauthorizedException();

    this.logger.log('postiz oauth webhook received, syncing accounts');
    await this.sync.sync().catch((e) => this.logger.error(`sync after oauth failed: ${e.message}`));
    return { ok: true };
  }
}
