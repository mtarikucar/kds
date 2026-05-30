import { Body, Controller, Delete, Get, Param, Post, Query, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';
import { Public } from '../auth/decorators/public.decorator';
import { IntegrationService } from './integration.service';

// v2.8.89 — integration provider connect/disconnect writes vendor
// credentials onto the tenant row (PII + money flow). Pre-v2.8.89 these
// endpoints carried only @UseGuards(JwtAuthGuard) — any role
// (WAITER/KITCHEN/COURIER) could spin up or revoke a Yemeksepeti /
// Hugin / e-Fatura connection. ADMIN/MANAGER class-level lock-down +
// per-method belt for the writes; reads stay open to authenticated
// roles only via the same class guard.
@ApiTags('Integrations')
@Controller('v1/integrations')
export class IntegrationController {
  constructor(private readonly svc: IntegrationService) {}

  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Marketplace of available integration providers' })
  list(@Query('kind') kind?: string) {
    return this.svc.listProviders(kind);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Post('connections')
  @ApiOperation({ summary: 'Connect a provider for the authenticated tenant (ADMIN/MANAGER)' })
  connect(
    @Req() req: any,
    @Body() body: { providerId: string; branchId?: string; credentials?: Record<string, unknown>; config?: Record<string, unknown> },
  ) {
    return this.svc.connect(req.user.tenantId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Get('connections')
  mine(@Req() req: any) {
    return this.svc.listMyConnections(req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Delete('connections/:id')
  disconnect(@Req() req: any, @Param('id') id: string) {
    return this.svc.disconnect(req.user.tenantId, id);
  }

  /**
   * Public webhook ingest. Tenant is encoded in the URL because most
   * providers issue one URL per connection — adapter-side signature
   * verification gates trust.
   */
  @Public()
  @Post('webhooks/:providerId/:tenantId')
  webhook(
    @Param('providerId') providerId: string,
    @Param('tenantId') tenantId: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return this.svc.ingestWebhook(providerId, tenantId, req.headers as any, raw);
  }
}
