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
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingRoles } from '../decorators/marketing-roles.decorator';
import { MarketingOffersService } from '../services/marketing-offers.service';
import { CreateOfferDto } from '../dto/create-offer.dto';
import { UpdateOfferDto } from '../dto/update-offer.dto';

@Controller('marketing/offers')
@UseGuards(MarketingGuard, MarketingRolesGuard)
export class MarketingOffersController {
  constructor(private readonly offersService: MarketingOffersService) {}

  @Post()
  create(@Body() dto: CreateOfferDto, @CurrentMarketingUser() user: any) {
    return this.offersService.create(dto, user.id);
  }

  @Get()
  findAll(
    @CurrentMarketingUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.offersService.findAll(user.id, user.role, page, limit);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.offersService.findOne(id);
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

  @Delete(':id')
  @MarketingRoles('SALES_MANAGER')
  delete(@Param('id') id: string) {
    return this.offersService.delete(id);
  }
}
