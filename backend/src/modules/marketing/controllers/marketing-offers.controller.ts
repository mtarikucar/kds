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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MarketingRoute } from '../decorators/marketing-route.decorator';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingRoles } from '../decorators/marketing-roles.decorator';
import { MarketingOffersService } from '../services/marketing-offers.service';
import { CreateOfferDto } from '../dto/create-offer.dto';
import { UpdateOfferDto } from '../dto/update-offer.dto';
import { OfferFilterDto } from '../dto/offer-filter.dto';

@MarketingRoute()
@Controller('marketing/offers')
@UseGuards(MarketingGuard, MarketingRolesGuard)
export class MarketingOffersController {
  constructor(private readonly offersService: MarketingOffersService) {}

  @Post()
  create(@Body() dto: CreateOfferDto, @CurrentMarketingUser() user: any) {
    return this.offersService.create(dto, user.id, user.role);
  }

  @Get()
  findAll(
    @CurrentMarketingUser() user: any,
    @Query() filter: OfferFilterDto,
  ) {
    return this.offersService.findAll(user.id, user.role, filter);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentMarketingUser() user: any) {
    return this.offersService.findOne(id, user.id, user.role);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOfferDto,
    @CurrentMarketingUser() user: any,
  ) {
    return this.offersService.update(id, dto, user.id, user.role);
  }

  @Post(':id/send')
  markSent(@Param('id') id: string, @CurrentMarketingUser() user: any) {
    return this.offersService.markSent(id, user.id, user.role);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@Param('id') id: string, @CurrentMarketingUser() user: any) {
    return this.offersService.accept(id, user.id, user.role);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id') id: string, @CurrentMarketingUser() user: any) {
    return this.offersService.reject(id, user.id, user.role);
  }

  @Delete(':id')
  @MarketingRoles('SALES_MANAGER')
  delete(@Param('id') id: string) {
    return this.offersService.delete(id);
  }
}
