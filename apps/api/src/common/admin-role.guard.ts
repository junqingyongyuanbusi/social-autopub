import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

// 仅 admin 角色可访问（挂在 AdminKeyGuard 之后）。
// 无 x-user-role 头 = 持服务密钥的运维/脚本直调，放行
@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const role = req.header('x-user-role');
    if (role && role !== 'admin') throw new ForbiddenException('admin only');
    return true;
  }
}
