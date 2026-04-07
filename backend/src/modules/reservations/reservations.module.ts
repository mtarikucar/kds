import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SmsSettingsModule } from '../sms-settings/sms-settings.module';
import { ReservationsController } from './controllers/reservations.controller';
import { PublicReservationsController } from './controllers/public-reservations.controller';
import { ReservationsService } from './services/reservations.service';
import { ReservationSettingsService } from './services/reservation-settings.service';

@Module({
  imports: [PrismaModule, NotificationsModule, SubscriptionsModule, SmsSettingsModule],
  controllers: [ReservationsController, PublicReservationsController],
  providers: [ReservationsService, ReservationSettingsService],
  exports: [ReservationsService, ReservationSettingsService],
})
export class ReservationsModule {}
