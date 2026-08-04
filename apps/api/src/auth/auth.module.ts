import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { SeedService } from './seed.service';

@Module({
  controllers: [AuthController],
  providers: [SeedService],
})
export class AuthModule {}
