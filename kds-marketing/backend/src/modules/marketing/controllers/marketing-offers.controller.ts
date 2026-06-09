import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { MarketingRoute } from '../decorators/marketing-public.decorator';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingRoles } from '../decorators/marketing-roles.decorator';
import { MarketingOffersService } from '../services/marketing-offers.service';
import { CreateOfferDto } from '../dto/create-offer.dto';
import { UpdateOfferDto } from '../dto/update-offer.dto';
import { MarketingUserPayload } from '../types';

@Controller('marketing/offers')
@UseGuards(MarketingGuard, MarketingRolesGuard)
@MarketingRoute()
export class MarketingOffersController {
  constructor(private readonly offersService: MarketingOffersService) {}

  @Post()
  create(@Body() dto: CreateOfferDto, @CurrentMarketingUser() user: MarketingUserPayload) {
    return this.offersService.create(dto, user.id, user.role);
  }

  @Get()
  findAll(
    @CurrentMarketingUser() user: MarketingUserPayload,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.offersService.findAll(user.id, user.role, page, limit);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentMarketingUser() user: MarketingUserPayload) {
    return this.offersService.findOne(id, user.id, user.role);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOfferDto,
    @CurrentMarketingUser() user: MarketingUserPayload,
  ) {
    return this.offersService.update(id, dto, user.id, user.role);
  }

  @Post(':id/send')
  markSent(@Param('id') id: string, @CurrentMarketingUser() user: MarketingUserPayload) {
    return this.offersService.markSent(id, user.id, user.role);
  }

  @Delete(':id')
  @MarketingRoles('SALES_MANAGER')
  delete(@Param('id') id: string) {
    return this.offersService.delete(id);
  }
}
