import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { EmailService } from "../../common/services/email.service";
import { DomainEventBus } from "../outbox/domain-event-bus.service";
import { EventTypes, HardwareOrderPlacedPayload } from "../outbox/event-types";

// v2.8.86 — listens for hardware.order.placed.v1 and sends the buyer
// the order-placed email.
//
// The producer (CheckoutService) emits inside the same Prisma transaction
// that mints the HardwareOrder, so the event is guaranteed-or-rolled-back.
// The outbox worker dispatches it through DomainEventBus, which since
// iter-14 isolates per-listener throws — a thrown handler is logged
// without aborting the dispatch loop or feedback-looping the worker into
// double provisioning.
//
// Idempotency: in-process bus delivery is at-least-once. A retry would
// re-send the same email. EmailService is a thin wrapper over nodemailer
// and doesn't track sent-state, so we accept that pessimistically — the
// only places a retry actually fires are (a) NestJS test boot races
// (single-instance, never hits) and (b) the outbox worker's retry on
// dispatch failure, which only fires when an EARLIER listener throws
// because DomainEventBus.dispatch is per-listener isolated. So in
// practice each delivery → at most one email. We don't add a
// notifications-sent ledger here for that reason; if v2.9.x adds a
// transactional retry path, that ledger lands then.

@Injectable()
export class CheckoutNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(CheckoutNotificationsService.name);

  constructor(
    private readonly bus: DomainEventBus,
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.bus.on(EventTypes.HardwareOrderPlaced, async (event) => {
      const payload = event.payload as HardwareOrderPlacedPayload;
      if (!payload?.hardwareOrderId) {
        this.logger.warn(
          `HardwareOrderPlaced received with no hardwareOrderId (event=${event.id})`,
        );
        return;
      }
      try {
        await this.sendOrderPlacedEmail(payload);
      } catch (err) {
        // Per the bus contract, throwing only logs — don't bubble or
        // we'd feedback-loop the worker. Keep the diagnostic loud so
        // ops notices a stuck SMTP / template rendering issue.
        this.logger.error(
          `Order-placed email failed order=${payload.hardwareOrderId}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    });
  }

  /**
   * Look up the order + items + tenant + recipient, render
   * order-placed.hbs and ship it via EmailService.
   *
   * Recipient resolution (in order):
   *   1. The tenant's first ACTIVE ADMIN user (by createdAt) — this is
   *      the person who owns the account and signed the contract.
   *   2. The tenant's `reportEmails[0]` if no admin exists (degraded —
   *      reportEmails is an ops-configured list, but a placed order
   *      should NEVER go undelivered just because the admin row was
   *      soft-deleted).
   *   3. Skip + log if neither yields a target.
   */
  async sendOrderPlacedEmail(
    payload: HardwareOrderPlacedPayload,
  ): Promise<void> {
    const order = await this.prisma.hardwareOrder.findFirst({
      where: { id: payload.hardwareOrderId, tenantId: payload.tenantId },
      include: { items: true },
    });
    if (!order) {
      this.logger.warn(
        `HardwareOrder ${payload.hardwareOrderId} not found for tenant ${payload.tenantId} — event possibly raced ahead of commit?`,
      );
      return;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: {
        name: true,
        reportEmails: true,
        users: {
          where: { role: "ADMIN", status: "ACTIVE" },
          select: { email: true, firstName: true, lastName: true },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });
    if (!tenant) {
      this.logger.warn(
        `Tenant ${payload.tenantId} not found at email-send time`,
      );
      return;
    }

    const admin = tenant.users[0];
    const fallback = tenant.reportEmails?.[0];
    const recipientEmail = admin?.email ?? fallback;
    if (!recipientEmail) {
      this.logger.warn(
        `No recipient for order=${payload.hardwareOrderId} tenant=${payload.tenantId} — no ACTIVE ADMIN and no reportEmails`,
      );
      return;
    }
    const recipientName = admin
      ? `${admin.firstName} ${admin.lastName}`.trim() || admin.email
      : recipientEmail;

    const currency = order.currency;
    const fmt = (cents: number) => `${(cents / 100).toFixed(2)} ${currency}`;
    const items = order.items.map((it) => ({
      name: it.name,
      qty: it.qty,
      lineTotal: fmt(it.unitCents * it.qty),
    }));

    // Pull the address out of the Json column. The shape isn't strict
    // (v2.8.84 lands the form) so render it conservatively — strings
    // pass through, structured shapes get joined line by line. If it's
    // absent (admin-comp path doesn't require it) we skip the section.
    const shippingAddressLines = this.formatAddress(order.shippingAddress);

    // Order number presented to the buyer: short slice of the UUID. The
    // canonical id stays in the URL.
    const shortId = order.id.slice(0, 8);

    await this.email.sendEmail({
      to: recipientEmail,
      subject: `Donanım siparişiniz alındı — #${shortId}`,
      template: "order-placed",
      context: {
        recipientName,
        tenantName: tenant.name,
        orderNumber: shortId,
        orderId: order.id,
        orderDate: order.createdAt.toISOString().slice(0, 10),
        paymentRef: order.paymentRef,
        items,
        subtotal: fmt(order.subtotalCents),
        tax: fmt(order.taxCents),
        showTax: order.taxCents > 0,
        shipping: fmt(order.shippingCents),
        showShipping: order.shippingCents > 0,
        total: fmt(order.totalCents),
        shippingAddressLines,
        installationRequested: order.installation === "requested",
        appUrl: this.config.get<string>(
          "FRONTEND_URL",
          "https://hummytummy.com",
        ),
      },
    });

    this.logger.log(
      `order-placed email sent for order=${order.id} tenant=${payload.tenantId} to=${recipientEmail.replace(/(^.).+(@.+$)/, "$1***$2")}`,
    );
  }

  /**
   * Coerce the shippingAddress JSON column into renderable lines.
   * The v2.8.84 form will write a structured object; older rows may have
   * just a plain string. We render whatever's there safely so a future
   * schema tweak doesn't break the email.
   */
  private formatAddress(raw: unknown): string[] {
    if (!raw) return [];
    if (typeof raw === "string") {
      return raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const lines: string[] = [];
      const push = (v: unknown) => {
        if (typeof v === "string" && v.trim()) lines.push(v.trim());
      };
      push(obj.recipientName);
      push(obj.line1 ?? obj.street);
      push(obj.line2);
      const district = [obj.district, obj.city].filter(Boolean).join(", ");
      if (district) lines.push(district);
      push(obj.postalCode);
      push(obj.country);
      push(obj.phone);
      return lines;
    }
    return [];
  }
}
