import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

// INGEST_API_KEYS 格式：key:来源名，逗号分隔多组，如 "abc123:internal,def456:partner-a"
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly keys = new Map(
    (process.env.INGEST_API_KEYS ?? '')
      .split(',')
      .filter(Boolean)
      .map((pair) => {
        const [key, name] = pair.split(':');
        return [key.trim(), name?.trim() ?? 'unknown'] as const;
      }),
  );

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { callerName?: string }>();
    const key = req.header('x-api-key');
    if (!key || !this.keys.has(key)) throw new UnauthorizedException('invalid api key');
    req.callerName = this.keys.get(key);
    return true;
  }
}
