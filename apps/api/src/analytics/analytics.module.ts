import { Module } from '@nestjs/common';
import { PostizModule } from '../postiz/postiz.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsSyncService } from './analytics-sync.service';

// 社媒分析：Postiz analytics 定时采集（AnalyticsSyncService）+ 本地快照查询（AnalyticsService）
@Module({
  imports: [PostizModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsSyncService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
