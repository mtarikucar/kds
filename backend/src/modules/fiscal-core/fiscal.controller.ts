import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';
import { PlanFeatureGuard } from '../subscriptions/guards/plan-feature.guard';
import { RequiresIntegration } from '../subscriptions/decorators/requires-integration.decorator';
import { FiscalService } from './fiscal.service';
import { CancelReceiptDto } from './dto/cancel-receipt.dto';

// v2.8.88: fiscal recovery panel restricted to tenants who actually
// own a fiscal integration (Hugin / Beko yazarkasa or e-Fatura). FREE
// tenants without a YN ÖKC device have nothing to recover from. The
// integration gate routes through the engine, so `fiscal_hugin` /
// `fiscal_efatura` add-ons unlock it.
@ApiTags('Fiscal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@RequiresIntegration('fiscal')
@Controller('v1/fiscal')
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  @Get('pending')
  @ApiOperation({ summary: 'Queued + failed receipts — drives the manual recovery panel' })
  pending(@Req() req: any, @Query('limit') limit?: string) {
    return this.fiscal.listPending(req.user.tenantId, limit ? parseInt(limit, 10) : 100);
  }

  @Post('receipts/:id/retry')
  @ApiOperation({ summary: 'Re-dispatch a queued/failed receipt to its adapter (uses original idempotency key)' })
  retry(@Req() req: any, @Param('id') id: string) {
    return this.fiscal.retryFailed(req.user.tenantId, id);
  }

  @Post('receipts/:id/cancel')
  @ApiOperation({ summary: 'Cancel an already-issued receipt' })
  cancel(@Req() req: any, @Param('id') id: string, @Body() body: CancelReceiptDto) {
    return this.fiscal.cancelReceipt(req.user.tenantId, id, body.reason);
  }

  @Post('devices/:id/close-day')
  @ApiOperation({ summary: 'Close the fiscal day — runs Z report' })
  closeDay(@Req() req: any, @Param('id') id: string) {
    return this.fiscal.closeDay(req.user.tenantId, id);
  }
}
