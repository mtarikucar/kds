import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { SmsSettingsModule } from "../sms-settings/sms-settings.module";
// KdsGateway: reservation status flips (seat/cancel/no-show + the auto-hold /
// release crons) emit floor:layout-updated so live POS/Tables maps recolor.
import { KdsModule } from "../kds/kds.module";
import { ReservationsController } from "./controllers/reservations.controller";
import { PublicReservationsController } from "./controllers/public-reservations.controller";
import { ReservationsService } from "./services/reservations.service";
import { ReservationAvailabilityService } from "./services/reservation-availability.service";
import { ReservationSettingsService } from "./services/reservation-settings.service";
import { ReservationSchedulerService } from "./services/reservation-scheduler.service";
import { ReservationNotificationService } from "./services/reservation-notification.service";

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    SubscriptionsModule,
    SmsSettingsModule,
    KdsModule,
  ],
  controllers: [ReservationsController, PublicReservationsController],
  providers: [
    ReservationsService,
    // Public-availability reads + shared public branch resolver, split out
    // of ReservationsService (god-file split). Injected back into
    // ReservationsService and the public controller.
    ReservationAvailabilityService,
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
  // ReservationAvailabilityService is exported so TablesModule's public
  // customer table listing can reuse resolvePublicBranchId (the single
  // canonical public branch resolver) rather than re-deriving it.
  exports: [
    ReservationsService,
    ReservationSettingsService,
    ReservationAvailabilityService,
  ],
})
export class ReservationsModule {}
