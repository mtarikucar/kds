import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Headers,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { CustomerSelfPayService } from '../services/customer-self-pay.service';
import { CreatePayIntentDto } from '../dto/pay-intent.dto';

/**
 * Customer-facing self-pay endpoints. All routes are @Public — the
 * server authenticates the caller via sessionId in the URL and
 * resolves tenantId from CustomerSession (never from the body).
 */
@ApiTags('customer-self-pay')
@Controller('customer-orders/sessions/:sessionId')
@Public()
export class CustomerSelfPayController {
  constructor(private readonly service: CustomerSelfPayService) {}

  @Get('payable-items')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'List unpaid items across all open orders at the session\'s table',
  })
  @ApiResponse({ status: 200, description: 'Table-wide payable items' })
  @ApiResponse({ status: 404, description: 'Session not found / expired' })
  getPayableItems(@Param('sessionId') sessionId: string) {
    return this.service.getPayableItemsForSession(sessionId);
  }

  @Post('pay-intent')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Create a PayTR hosted-iFrame intent for the items the customer selected',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns paymentLink to redirect the customer to',
  })
  @ApiResponse({
    status: 400,
    description:
      'Non-Turkey tenant, takeaway session, invalid item, or insufficient remaining quantity',
  })
  @ApiResponse({ status: 404, description: 'Session not found / expired' })
  createIntent(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreatePayIntentDto,
    @Req() req: any,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ) {
    // Real client IP, with proxy header preferred over the socket.
    const ip =
      (forwardedFor?.split(',')[0]?.trim()) ||
      req?.ip ||
      req?.connection?.remoteAddress ||
      '0.0.0.0';
    return this.service.createPayIntent(sessionId, dto, ip);
  }

  @Get('pay-status')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Poll the PendingSelfPayment row + return current remaining items',
  })
  @ApiResponse({ status: 200, description: 'Status + remaining summary' })
  @ApiResponse({ status: 404, description: 'Intent or session not found' })
  getStatus(
    @Param('sessionId') sessionId: string,
    @Query('oid') merchantOid: string,
  ) {
    return this.service.getPayStatus(sessionId, merchantOid);
  }
}
