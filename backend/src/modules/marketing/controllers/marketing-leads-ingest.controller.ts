import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IngestTokenGuard } from '../guards/ingest-token.guard';
import { IngestLeadsDto } from '../dto/ingest-leads.dto';
import { MarketingLeadsIngestService } from '../services/marketing-leads-ingest.service';

/**
 * Separate controller class — not folded into MarketingLeadsController —
 * so this route bypasses MarketingGuard (JWT) entirely. The daily AI
 * research routine authenticates with a static x-ingest-token header
 * checked by IngestTokenGuard.
 */
@Controller('marketing/leads')
@UseGuards(IngestTokenGuard)
@Throttle({ long: { limit: 6, ttl: 60_000 } })
export class MarketingLeadsIngestController {
  constructor(private readonly svc: MarketingLeadsIngestService) {}

  @Post('ingest')
  @HttpCode(200)
  ingest(@Body() dto: IngestLeadsDto) {
    return this.svc.ingest(dto);
  }
}
