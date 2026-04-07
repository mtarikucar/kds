import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string, @CurrentUser('id') userId: string) {
    return this.service.findAll(tenantId, userId);
  }

  @Post(':id/read')
  markAsRead(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('tenantId') tenantId: string) {
    return this.service.markAsRead(id, userId, tenantId);
  }

  @Post('mark-all-read')
  markAllAsRead(@CurrentUser('tenantId') tenantId: string, @CurrentUser('id') userId: string) {
    return this.service.markAllAsRead(tenantId, userId);
  }
}
