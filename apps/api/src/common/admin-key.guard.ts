import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

// 管理面接口鉴权：console 服务端代理携带 x-admin-key 访问
// 未配置 ADMIN_API_KEY 时放行并告警（便于首次部署），生产必须配置
@Injectable()
export class AdminKeyGuard implements CanActivate {
  private static warned = false;

  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
      if (!AdminKeyGuard.warned) {
        new Logger(AdminKeyGuard.name).warn('ADMIN_API_KEY 未配置，管理接口当前无鉴权！生产环境必须设置');
        AdminKeyGuard.warned = true;
      }
      return true;
    }
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.header('x-admin-key') !== expected) throw new UnauthorizedException('invalid admin key');
    return true;
  }
}
