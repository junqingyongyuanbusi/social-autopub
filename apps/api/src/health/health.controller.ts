import { Controller, Get } from '@nestjs/common';

@Controller('healthz')
export class HealthController {
  @Get()
  check() {
    return { ok: true, ts: new Date().toISOString() };
  }
}
