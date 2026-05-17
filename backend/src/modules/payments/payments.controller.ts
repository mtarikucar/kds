import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreateIntentDto } from './dto/create-intent.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * Subscription-payment intents. JwtAuthGuard / TenantGuard / RolesGuard
 * are applied globally via APP_GUARD in AuthModule, so no per-controller
 * @UseGuards is required.
 */
@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('create-intent')
  @HttpCode(200)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  // Override the default 100/minute "long" throttle — each intent
  // creates a PENDING SubscriptionPayment + (possibly) a PENDING
  // Subscription + calls PayTR's get-token. A rapid-click attacker
  // could otherwise burn orphan rows and hammer PayTR's API. Five
  // attempts per minute is plenty for a real user retrying after
  // a typo.
  @Throttle({ long: { ttl: 60_000, limit: 5 } })
  async createIntent(@Body() dto: CreateIntentDto, @Req() req: any) {
    const userIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      '0.0.0.0';
    return this.payments.createIntent(req.user.tenantId, req.user.id, dto, userIp);
  }
}
