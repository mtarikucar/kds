import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IngestTokenGuard } from '../guards/ingest-token.guard';
import { IngestLeadsDto } from '../dto/ingest-leads.dto';
import { MarketingLeadsIngestService } from '../services/marketing-leads-ingest.service';
import { MarketingRoute } from '../decorators/marketing-public.decorator';

/**
 * Separate controller class — not folded into MarketingLeadsController —
 * so this route bypasses MarketingGuard (JWT) entirely. The daily AI
 * research routine authenticates with a static x-ingest-token header
 * checked by IngestTokenGuard.
 *
 * `@MarketingRoute()` skips the global JwtAuthGuard / TenantGuard /
 * RolesGuard pipeline (which would otherwise 401 before the static
 * token check even runs). Mirrors every other controller in this
 * module.
 */
@Controller('marketing/leads')
@MarketingRoute()
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
