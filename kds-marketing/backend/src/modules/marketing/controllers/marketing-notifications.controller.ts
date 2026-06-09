import { Controller, Get, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { MarketingRoute } from '../decorators/marketing-public.decorator';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingNotificationsService } from '../services/marketing-notifications.service';

@MarketingRoute()
@Controller('marketing/notifications')
@UseGuards(MarketingGuard, MarketingRolesGuard)
export class MarketingNotificationsController {
  constructor(private readonly notificationsService: MarketingNotificationsService) {}

  @Get()
  findAll(@CurrentMarketingUser() user: any, @Query('isRead') isRead?: string) {
    const parsed = isRead === 'true' ? true : isRead === 'false' ? false : undefined;
    return this.notificationsService.findAll(user.id, parsed);
  }

  @Get('unread-count')
  getUnreadCount(@CurrentMarketingUser() user: any) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentMarketingUser() user: any) {
    return this.notificationsService.markRead(id, user.id);
  }

  @Patch('read-all')
  markAllRead(@CurrentMarketingUser() user: any) {
    return this.notificationsService.markAllRead(user.id);
  }
}
