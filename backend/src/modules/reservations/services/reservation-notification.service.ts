import { Injectable, Logger } from "@nestjs/common";
import { EmailService } from "../../../common/services/email.service";
import { SmsNotificationService } from "../../sms-settings/sms-notification.service";
import { SmsSettingsService } from "../../sms-settings/sms-settings.service";

/**
 * Channel-aware customer notification for reservation lifecycle events.
 *
 * Routes email when the customer supplied an email AND the matching
 * `emailOn*` toggle on `SmsSettings` is on. Falls back to SMS otherwise
 * — or when the email send itself fails — so the customer is reachable
 * whenever they're reachable at all. The decision is made per call, not
 * per tenant, so a single tenant can serve both email-only and
 * phone-only customers from the same flow.
 *
 * The SMS path delegates to the existing {@link SmsNotificationService}
 * methods; this service does not reach into the SMS provider directly.
 * That keeps SMS gating (per-event toggles + tenant `isEnabled` switch)
 * in one place.
 */
export type ReservationEvent =
  | "created"
  | "confirmed"
  | "rejected"
  | "cancelled";

export interface ReservationNotificationCtx {
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  date: string; // pre-formatted (YYYY-MM-DD) — same as SMS layer expects
  startTime: string; // HH:mm
  reservationNumber: string;
  reason?: string; // populated only for rejection
}

const EMAIL_SUBJECTS: Record<ReservationEvent, string> = {
  created: "Rezervasyonunuz Alındı",
  confirmed: "Rezervasyonunuz Onaylandı",
  rejected: "Rezervasyonunuz Reddedildi",
  cancelled: "Rezervasyonunuz İptal Edildi",
};

@Injectable()
export class ReservationNotificationService {
  private readonly logger = new Logger(ReservationNotificationService.name);

  constructor(
    private email: EmailService,
    private smsNotificationService: SmsNotificationService,
    private smsSettingsService: SmsSettingsService,
  ) {}

  async notify(
    tenantId: string,
    event: ReservationEvent,
    ctx: ReservationNotificationCtx,
  ): Promise<void> {
    // Email first — when the customer left an email AND the matching
    // emailOn* toggle is on. We do not require `isEnabled` for email
    // because the master switch was named with SMS in mind; flipping it
    // off shouldn't silently kill email notifications too. Per-event
    // toggles remain the precise control.
    const settings = await this.smsSettingsService.findByTenant(tenantId);
    const emailKey = `emailOnReservation${cap(event)}` as keyof typeof settings;
    const emailToggleOn = Boolean(settings[emailKey]);

    if (ctx.customerEmail && emailToggleOn) {
      try {
        const ok = await this.email.sendEmail({
          to: ctx.customerEmail,
          subject: EMAIL_SUBJECTS[event],
          template: `reservation-${event}`,
          context: {
            customerName: ctx.customerName,
            date: ctx.date,
            startTime: ctx.startTime,
            reservationNumber: ctx.reservationNumber,
            reason: ctx.reason,
          },
        });
        if (ok) return;
        this.logger.warn(
          `Email send returned false for ${event}/${ctx.reservationNumber} — falling back to SMS`,
        );
      } catch (err: any) {
        this.logger.error(
          `Email send threw for ${event}/${ctx.reservationNumber}: ${err?.message ?? err}`,
        );
        // Fall through to SMS.
      }
    }

    // SMS fallback (or primary when no email). The SMS service does its
    // own gating against the tenant's smsOn* toggles and `isEnabled`
    // master switch.
    if (!ctx.customerPhone) {
      // Email-only customer with no email path available — nothing to
      // do. The reservation lifecycle continues regardless.
      return;
    }

    const data = {
      customerPhone: ctx.customerPhone,
      customerName: ctx.customerName,
      date: ctx.date,
      startTime: ctx.startTime,
      reservationNumber: ctx.reservationNumber,
      reason: ctx.reason,
    };

    switch (event) {
      case "created":
        await this.smsNotificationService.notifyReservationCreated(
          tenantId,
          data,
        );
        return;
      case "confirmed":
        await this.smsNotificationService.notifyReservationConfirmed(
          tenantId,
          data,
        );
        return;
      case "rejected":
        await this.smsNotificationService.notifyReservationRejected(
          tenantId,
          data,
        );
        return;
      case "cancelled":
        await this.smsNotificationService.notifyReservationCancelled(
          tenantId,
          data,
        );
        return;
    }
  }
}

function cap<T extends string>(s: T): Capitalize<T> {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as Capitalize<T>;
}
