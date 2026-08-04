import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { ingestSchema } from './ingest.schema';
import { IngestService } from './ingest.service';

@Controller('ingest')
@UseGuards(ApiKeyGuard)
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post()
  async create(@Body() body: unknown) {
    const parsed = ingestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const item = await this.ingest.upsert('http', parsed.data);
    return { content_item_id: item.id, status: item.status };
  }

  @Get(':id')
  async status(@Param('id') id: string) {
    const item = await this.ingest.findById(id);
    if (!item) throw new NotFoundException();
    return { content_item_id: item.id, status: item.status, jobs: item.jobs };
  }
}
