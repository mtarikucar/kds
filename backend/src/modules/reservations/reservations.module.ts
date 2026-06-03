import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { SmsSettingsModule } from "../sms-settings/sms-settings.module";
import { ReservationsController } from "./controllers/reservations.controller";
import { PublicReservationsController } from "./controllers/public-reservations.controller";
import { ReservationsService } from "./services/reservations.service";
import { ReservationSettingsService } from "./services/reservation-settings.service";
import { ReservationSchedulerService } from "./services/reservation-scheduler.service";
import { ReservationNotificationService } from "./services/reservation-notification.service";

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    SubscriptionsModule,
    SmsSettingsModule,
  ],
  controllers: [ReservationsController, PublicReservationsController],
  providers: [
    ReservationsService,
    ReservationSettingsService,
    // Channel-aware (email-first, SMS-fallback) customer notifications
    // for the 4 reservation lifecycle events. EmailService is provided
    // by the global CommonModule; SmsSettingsModule re-exports the SMS
    // service this one delegates to.
    ReservationNotificationService,
    // Cron jobs only — no HTTP surface. Lives in the module so the
    // existing @nestjs/schedule scanner picks it up at bootstrap.
    ReservationSchedulerService,
  ],
  exports: [ReservationsService, ReservationSettingsService],
})
export class ReservationsModule {}
