import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export interface RequestUser {
  id: string;
  role: 'admin' | 'operator';
}

// 从 console 服务端代理附带的用户头解析当前操作者。
// 信任基础：请求已通过 AdminKeyGuard（持服务密钥）；无用户头 = 运维/脚本直调，视为服务级 admin
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestUser => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const id = req.header('x-user-id') ?? '';
  const role = req.header('x-user-role') === 'operator' ? 'operator' : 'admin';
  return { id, role };
});

export const isAdmin = (user: RequestUser) => user.role === 'admin';
