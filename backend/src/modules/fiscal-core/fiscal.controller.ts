import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FiscalService } from './fiscal.service';

@ApiTags('Fiscal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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
  cancel(@Req() req: any, @Param('id') id: string, @Body() body: { reason: string }) {
    return this.fiscal.cancelReceipt(req.user.tenantId, id, body.reason);
  }

  @Post('devices/:id/close-day')
  @ApiOperation({ summary: 'Close the fiscal day — runs Z report' })
  closeDay(@Req() req: any, @Param('id') id: string) {
    return this.fiscal.closeDay(req.user.tenantId, id);
  }
}
