import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WebhookOutboundService } from './webhook-outbound.service';

@ApiTags('Webhooks · Outbound')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/webhooks/subscriptions')
export class WebhooksOutboundController {
  constructor(private readonly svc: WebhookOutboundService) {}

  @Get()
  list(@Req() req: any) {
    return this.svc.list(req.user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Subscribe to events. Secret is returned ONCE.' })
  subscribe(@Req() req: any, @Body() body: { url: string; events?: string[] }) {
    return this.svc.subscribe(req.user.tenantId, body);
  }

  @Delete(':id')
  revoke(@Req() req: any, @Param('id') id: string) {
    return this.svc.revoke(req.user.tenantId, id);
  }
}
