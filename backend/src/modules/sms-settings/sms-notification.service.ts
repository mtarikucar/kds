import { Injectable, Logger, Optional } from "@nestjs/common";
import { CreditService } from "../credits/credit.service";
import { SmsService } from "../customers/sms.service";
import { SmsSettingsService } from "./sms-settings.service";
import { maskPhone } from "../../common/helpers/pii-mask.helper";

@Injectable()
export class SmsNotificationService {
  private readonly logger = new Logger(SmsNotificationService.name);

  constructor(
    private smsService: SmsService,
    private smsSettingsService: SmsSettingsService,
    // v3.3.0 — SMS is metered. Optional so bare-constructed specs still
    // compile; when absent the send proceeds unmetered rather than silently
    // failing, because a missing collaborator must not stop a customer being
    // told their order is ready.
    @Optional() private readonly credits?: CreditService,
  ) {}

  // === RESERVATION SMS ===

  async notifyReservationCreated(
    tenantId: string,
    data: {
      customerPhone: string;
      customerName: string;
      date: string;
      startTime: string;
      reservationNumber: string;
    },
  ) {
    await this.sendIfEnabled(
      tenantId,
      "smsOnReservationCreated",
      data.customerPhone,
      `Sayin ${data.customerName}, ${data.date} tarihinde saat ${data.startTime} icin rezervasyonunuz alinmistir. Rezervasyon No: ${data.reservationNumber}. Onay icin sizinle iletisime gecilecektir.`,
    );
  }

  async notifyReservationConfirmed(
    tenantId: string,
    data: {
      customerPhone: string;
      customerName: string;
      date: string;
      startTime: string;
      reservationNumber: string;
    },
  ) {
    await this.sendIfEnabled(
      tenantId,
      "smsOnReservationConfirmed",
      data.customerPhone,
      `Sayin ${data.customerName}, ${data.date} tarihinde saat ${data.startTime} icin rezervasyonunuz onaylanmistir. Rezervasyon No: ${data.reservationNumber}. Hosgeldiniz!`,
    );
  }

  async notifyReservationRejected(
    tenantId: string,
    data: {
      customerPhone: string;
      customerName: string;
      date: string;
      startTime: string;
      reason?: string;
    },
  ) {
    const reasonText = data.reason ? ` Sebep: ${data.reason}` : "";
    await this.sendIfEnabled(
      tenantId,
      "smsOnReservationRejected",
      data.customerPhone,
      `Sayin ${data.customerName}, ${data.date} tarihinde saat ${data.startTime} icin rezervasyonunuz maalesef reddedilmistir.${reasonText} Baska bir zaman icin tekrar deneyebilirsiniz.`,
    );
  }

  async notifyReservationCancelled(
    tenantId: string,
    data: {
      customerPhone: string;
      customerName: string;
      date: string;
      startTime: string;
    },
  ) {
    await this.sendIfEnabled(
      tenantId,
      "smsOnReservationCancelled",
      data.customerPhone,
      `Sayin ${data.customerName}, ${data.date} tarihinde saat ${data.startTime} icin rezervasyonunuz iptal edilmistir.`,
    );
  }

  // === ORDER SMS ===

  async notifyOrderCreated(
    tenantId: string,
    data: {
      customerPhone: string;
      orderNumber: string;
    },
  ) {
    await this.sendIfEnabled(
      tenantId,
      "smsOnOrderCreated",
      data.customerPhone,
      `Siparissiniz alinmistir. Siparis No: ${data.orderNumber}. Siparissiniz en kisa surede hazirlanacaktir.`,
    );
  }

  async notifyOrderApproved(
    tenantId: string,
    data: {
      customerPhone: string;
      orderNumber: string;
    },
  ) {
    await this.sendIfEnabled(
      tenantId,
      "smsOnOrderApproved",
      data.customerPhone,
      `Siparissiniz onaylandi. Siparis No: ${data.orderNumber}. Hazirlama sureci baslamistir.`,
    );
  }

  async notifyOrderPreparing(
    tenantId: string,
    data: {
      customerPhone: string;
      orderNumber: string;
    },
  ) {
    await this.sendIfEnabled(
      tenantId,
      "smsOnOrderPreparing",
      data.customerPhone,
      `Siparissiniz hazirlaniyor. Siparis No: ${data.orderNumber}.`,
    );
  }

  async notifyOrderReady(
    tenantId: string,
    data: {
      customerPhone: string;
      orderNumber: string;
    },
  ) {
    await this.sendIfEnabled(
      tenantId,
      "smsOnOrderReady",
      data.customerPhone,
      `Siparissiniz hazir! Siparis No: ${data.orderNumber}. Afiyet olsun!`,
    );
  }

  async notifyOrderCancelled(
    tenantId: string,
    data: {
      customerPhone: string;
      orderNumber: string;
    },
  ) {
    await this.sendIfEnabled(
      tenantId,
      "smsOnOrderCancelled",
      data.customerPhone,
      `Siparissiniz iptal edilmistir. Siparis No: ${data.orderNumber}.`,
    );
  }

  // === CORE PRIVATE METHOD ===

  private async sendIfEnabled(
    tenantId: string,
    settingKey:
      | "smsOnReservationCreated"
      | "smsOnReservationConfirmed"
      | "smsOnReservationRejected"
      | "smsOnReservationCancelled"
      | "smsOnOrderCreated"
      | "smsOnOrderApproved"
      | "smsOnOrderPreparing"
      | "smsOnOrderReady"
      | "smsOnOrderCancelled",
    phone: string,
    message: string,
  ): Promise<void> {
    try {
      if (!phone) return;

      const settings = await this.smsSettingsService.findByTenant(tenantId);
      if (!settings.isEnabled) return;
      if (!settings[settingKey]) return;

      // Meter the send. Pre-3.3 nothing counted SMS at all, so selling an SMS
      // credit pack would have taken money against a balance that never
      // moved. Claim FIRST — a claim that fails must not send — and refund if
      // the gateway then rejects the message, so a failed send never costs
      // the customer a credit.
      let ledgerId: string | null = null;
      if (this.credits) {
        try {
          ledgerId = await this.credits.claim(tenantId, "SMS", 1, {
            type: "sms_message",
          });
        } catch (err: any) {
          // Out of credit is a normal state, not an error worth alerting on:
          // the operator sees the balance in the app and buys another pack.
          this.logger.warn(
            `SMS skipped for tenant=${tenantId}: ${err?.message ?? "no credit"}`,
          );
          return;
        }
      }

      // Task 11: this call runs inside a fire-and-forget .catch() and can
      // be reached from non-request paths (order/reservation lifecycle
      // events) — pass tenantId explicitly (already in scope) rather than
      // depending on the ambient RequestContext surviving into this
      // continuation.
      this.smsService.send(phone, message, tenantId).catch(async (err) => {
        this.logger.error(
          `SMS send failed for ${maskPhone(phone)}: ${err.message}`,
        );
        if (ledgerId) await this.credits?.void(ledgerId).catch(() => undefined);
      });
    } catch (err) {
      this.logger.error(`SMS notification check failed: ${err.message}`);
    }
  }
}
