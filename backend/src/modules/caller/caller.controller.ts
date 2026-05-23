import { Body, Controller, Get, Headers, Param, Post, Query, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { CallerService } from './caller.service';
import { MockCallerProvider } from './adapters/mock-caller.provider';

@ApiTags('Caller')
@Controller('v1/caller')
export class CallerController {
  constructor(
    private readonly caller: CallerService,
    private readonly mockProvider: MockCallerProvider,
  ) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('recent')
  @ApiOperation({ summary: 'Last N caller events for the tenant — drives the calls feed UI' })
  recent(@Req() req: any, @Query('limit') limit?: string) {
    return this.caller.listRecent(req.user.tenantId, limit ? parseInt(limit, 10) : 50);
  }

  // Webhook receiver. Path includes the provider so we route to the right
  // adapter; tenant resolution happens via the URL param (the provider hands
  // out one webhook URL per tenant).
  @Public()
  @Post('webhooks/:providerId/:tenantId')
  @ApiOperation({ summary: 'Provider-side webhook ingest. Signature verified by the adapter.' })
  async webhook(
    @Param('providerId') providerId: string,
    @Param('tenantId') tenantId: string,
    @Headers('x-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    let events: any[] = [];
    if (providerId === 'mock') {
      events = await this.mockProvider.parseWebhook(signature, raw);
    } else {
      // TODO: registry lookup once more providers are added.
      events = [];
    }
    for (const ev of events) {
      await this.caller.ingest(tenantId, ev);
    }
    return { ingested: events.length };
  }
}
