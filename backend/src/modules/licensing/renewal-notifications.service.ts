import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { DomainEventBus } from "../outbox/domain-event-bus.service";
import { EventTypes } from "../outbox/event-types";
import { NotificationService } from "../subscriptions/services/notification.service";

interface RenewalReminderPayload {
  tenantId: string;
  renewalCycleId: string;
  anniversaryAt: string;
  daysLeft: number;
  totalCents: number;
  currency: string;
}

/**
 * Turns a RenewalReminder event into the actual email.
 *
 * Without this the scheduler emitted the event, the outbox delivered it, and
 * nothing was listening — reminders would have been "sent" 30, 7 and 1 days
 * out and never reached a customer, who would then discover the renewal by
 * losing access to a module. The event exists so the reminder is retryable and
 * idempotent (RenewalCycle.remindersSent gates the emit); this is the half
 * that makes it visible.
 */
@Injectable()
export class RenewalNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(RenewalNotificationsService.name);

  constructor(
    private readonly bus: DomainEventBus,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.bus.on(EventTypes.RenewalReminder, async (event) => {
      const payload = event.payload as unknown as RenewalReminderPayload;
      if (!payload?.renewalCycleId) {
        this.logger.warn(
          `RenewalReminder with no renewalCycleId (event=${event.id})`,
        );
        return;
      }
      try {
        await this.send(payload);
      } catch (err) {
        // Per the bus contract, throwing only logs — bubbling would
        // feedback-loop the outbox worker. Keep the diagnostic loud: a silent
        // SMTP failure here is a customer who never hears about their bill.
        this.logger.error(
          `Renewal reminder failed for cycle=${payload.renewalCycleId}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    });
  }

  private async send(payload: RenewalReminderPayload): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { name: true, reportEmails: true },
    });
    if (!tenant) return;

    // Same recipient resolution the order-placed email uses: the account
    // owner first, then the ops-configured list. A bill must not go
    // undelivered because the admin row was soft-deleted.
    const admin = await this.prisma.user.findFirst({
      where: { tenantId: payload.tenantId, role: "ADMIN", status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { email: true },
    });
    const to = admin?.email ?? tenant.reportEmails?.[0];
    if (!to) {
      this.logger.warn(
        `No recipient for renewal reminder tenant=${payload.tenantId}`,
      );
      return;
    }

    await this.notifications.sendRenewalReminder(to, {
      tenantName: tenant.name,
      anniversaryAt: new Date(payload.anniversaryAt),
      daysLeft: payload.daysLeft,
      totalCents: payload.totalCents,
      currency: payload.currency,
      renewalCycleId: payload.renewalCycleId,
    });
    this.logger.log(
      `Renewal reminder sent tenant=${payload.tenantId} daysLeft=${payload.daysLeft}`,
    );
  }
}
