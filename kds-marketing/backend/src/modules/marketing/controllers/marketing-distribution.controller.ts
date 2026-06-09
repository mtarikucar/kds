import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { MarketingRoute } from '../decorators/marketing-public.decorator';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingRoles } from '../decorators/marketing-roles.decorator';
import { MarketingDistributionService } from '../services/marketing-distribution.service';
import { UpdateDistributionConfigDto } from '../dto/update-distribution-config.dto';
import { MarketingUserPayload } from '../types';

@Controller('marketing/distribution-config')
@UseGuards(MarketingGuard, MarketingRolesGuard)
@MarketingRoute()
@MarketingRoles('SALES_MANAGER')
export class MarketingDistributionController {
  constructor(private readonly service: MarketingDistributionService) {}

  @Get()
  get() {
    return this.service.get();
  }

  @Patch()
  update(
    @Body() dto: UpdateDistributionConfigDto,
    @CurrentMarketingUser() user: MarketingUserPayload,
  ) {
    return this.service.update(dto.strategy ?? 'DISABLED', user.id);
  }
}
