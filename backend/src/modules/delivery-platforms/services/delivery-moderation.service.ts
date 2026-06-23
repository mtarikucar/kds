import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Order } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { AdapterFactory } from "../adapters/adapter-factory";
import { DeliveryConfigService } from "./delivery-config.service";
import { DeliveryAuthService } from "./delivery-auth.service";
import { DeliveryLogService } from "./delivery-log.service";
import {
  PlatformLogAction,
  PlatformLogDirection,
} from "../constants/platform.enum";
import { OrderStatus } from "../../../common/constants/order-status.enum";

/**
 * Operator-driven moderation of incoming delivery-platform orders, callable
 * from the KDS screen: ACCEPT / REJECT(reason) / set PREP-TIME.
 *
 * Every method resolves the internal Order tenant-scoped (and asserts it came
 * from a platform, i.e. `source` is set + `externalOrderId` present), drives
 * the matching adapter call through DeliveryConfigService (decrypted config) +
 * DeliveryAuthService (fresh token) + AdapterFactory, THEN updates the internal
 * Order status and records the reason/prep-time.
 *
 * Honesty contract: we never fabricate platform success. If the adapter call
 * throws (HTTP error, bad credentials, …) the error propagates — the internal
 * status is NOT advanced and the failure is recorded (log + circuit-breaker).
 * Operations are idempotent: re-accepting an already-accepted order, or
 * re-rejecting an already-rejected one, is a no-op rather than a double-send.
 *
 * NOTE: deliberately does NOT touch delivery-order.service.ts or the webhook
 * controller — all moderation logic lives here.
 */
@Injectable()
export class DeliveryModerationService {
  private readonly logger = new Logger(DeliveryModerationService.name);

  // Internal statuses that mean "the operator has already moved past the
  // pending-approval gate" — used for accept idempotency.
  private static readonly ALREADY_ACCEPTED: ReadonlySet<string> = new Set([
    OrderStatus.PENDING,
    OrderStatus.PREPARING,
    OrderStatus.READY,
    OrderStatus.SERVED,
    OrderStatus.PAID,
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
    private readonly configService: DeliveryConfigService,
    private readonly authService: DeliveryAuthService,
    private readonly logService: DeliveryLogService,
  ) {}

  /**
   * Accept a pending delivery order. Optionally also commits a prep time in
   * the same action (operator taps "Accept · 20 min").
   *
   * Idempotent: an order already past PENDING_APPROVAL is returned unchanged
   * (`alreadyAccepted: true`) without re-hitting the platform.
   */
  async acceptOrder(
    tenantId: string,
    orderId: string,
    prepTimeMinutes?: number,
  ): Promise<Order & { alreadyAccepted?: boolean }> {
    const order = await this.resolvePlatformOrder(tenantId, orderId);

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException(
        "Order was already rejected/cancelled and cannot be accepted",
      );
    }
    // Idempotency: already accepted (or further along) — don't re-send.
    if (DeliveryModerationService.ALREADY_ACCEPTED.has(order.status)) {
      this.logger.debug(
        `Order ${orderId} already in status ${order.status} — accept is a no-op`,
      );
      return { ...order, alreadyAccepted: true };
    }

    const minutes =
      prepTimeMinutes !== undefined
        ? this.assertPrepMinutes(prepTimeMinutes)
        : undefined;

    await this.dispatchToPlatform(order, async (adapter, config) => {
      await adapter.acceptOrder(config, order.externalOrderId!);
    });

    await this.logService.log({
      tenantId,
      platform: order.source!,
      direction: PlatformLogDirection.OUTBOUND,
      action: PlatformLogAction.ORDER_ACCEPTED,
      orderId: order.id,
      externalId: order.externalOrderId!,
      request: minutes !== undefined ? { prepTimeMinutes: minutes } : undefined,
      success: true,
    });

    // Platform side succeeded — now advance the internal order. Accepting an
    // order moves it from PENDING_APPROVAL into the kitchen queue (PENDING),
    // matching the autoAccept path in processIncomingOrder.
    const updated = await this.transition(tenantId, order, {
      status: OrderStatus.PENDING,
      requiresApproval: false,
      approvedAt: new Date(),
      notes:
        minutes !== undefined
          ? this.appendNote(order.notes, `Accepted · prep ${minutes} min`)
          : this.appendNote(order.notes, "Accepted"),
    });

    return updated;
  }

  /**
   * Reject a pending delivery order. The reason is REQUIRED, sent to the
   * platform (so the customer/courier sees why), and recorded internally.
   *
   * Idempotent: an already-cancelled order is returned unchanged. An order
   * that's already been accepted (PREPARING/READY/…) cannot be rejected via
   * this path — use the cancel flow instead.
   */
  async rejectOrder(
    tenantId: string,
    orderId: string,
    reason: string,
  ): Promise<Order & { alreadyRejected?: boolean }> {
    const cleanReason = (reason ?? "").trim();
    if (!cleanReason) {
      throw new BadRequestException("A rejection reason is required");
    }

    const order = await this.resolvePlatformOrder(tenantId, orderId);

    // Idempotency: already cancelled/rejected — no-op.
    if (order.status === OrderStatus.CANCELLED) {
      this.logger.debug(
        `Order ${orderId} already CANCELLED — reject is a no-op`,
      );
      return { ...order, alreadyRejected: true };
    }
    // Only un-moderated (PENDING_APPROVAL) or freshly-accepted-but-not-started
    // (PENDING) orders can be rejected outright. Past that the kitchen has
    // committed; a cancellation is a different, heavier flow.
    if (
      order.status !== OrderStatus.PENDING_APPROVAL &&
      order.status !== OrderStatus.PENDING
    ) {
      throw new BadRequestException(
        `Order in status ${order.status} can no longer be rejected`,
      );
    }

    const truncatedReason = cleanReason.slice(0, 500);

    // Reject MUST carry the reason to the platform.
    await this.dispatchToPlatform(order, async (adapter, config) => {
      await adapter.rejectOrder(
        config,
        order.externalOrderId!,
        truncatedReason,
      );
    });

    await this.logService.log({
      tenantId,
      platform: order.source!,
      direction: PlatformLogDirection.OUTBOUND,
      action: PlatformLogAction.ORDER_REJECTED,
      orderId: order.id,
      externalId: order.externalOrderId!,
      request: { reason: truncatedReason },
      success: true,
    });

    const updated = await this.transition(tenantId, order, {
      status: OrderStatus.CANCELLED,
      cancelledAt: new Date(),
      notes: this.appendNote(order.notes, `Rejected: ${truncatedReason}`),
    });

    return updated;
  }

  /**
   * Set/commit the kitchen prep time for an accepted delivery order. Tells the
   * platform the order is now being prepared (markPreparing) and records the
   * promised minutes internally.
   *
   * Idempotent: re-sending PREPARING for an order already PREPARING just
   * updates the recorded minutes; it doesn't bounce a later status backwards.
   */
  async setPrepTime(
    tenantId: string,
    orderId: string,
    minutes: number,
  ): Promise<Order> {
    const prepMinutes = this.assertPrepMinutes(minutes);
    const order = await this.resolvePlatformOrder(tenantId, orderId);

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.PAID
    ) {
      throw new BadRequestException(
        `Cannot set prep time on an order in status ${order.status}`,
      );
    }
    if (order.status === OrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        "Accept the order before setting a prep time",
      );
    }

    await this.dispatchToPlatform(order, async (adapter, config) => {
      await adapter.markPreparing(config, order.externalOrderId!);
    });

    await this.logService.log({
      tenantId,
      platform: order.source!,
      direction: PlatformLogDirection.OUTBOUND,
      action: PlatformLogAction.ORDER_PREPARING,
      orderId: order.id,
      externalId: order.externalOrderId!,
      request: { prepTimeMinutes: prepMinutes },
      success: true,
    });

    // Don't bounce an order that's already READY/SERVED back to PREPARING —
    // only advance forward from PENDING. Either way record the prep minutes.
    const advance = order.status === OrderStatus.PENDING;
    const updated = await this.transition(tenantId, order, {
      ...(advance
        ? { status: OrderStatus.PREPARING, preparingAt: new Date() }
        : {}),
      notes: this.appendNote(order.notes, `Prep time: ${prepMinutes} min`),
    });

    return updated;
  }

  // ----------------------------------------------------------------------
  // Internals
  // ----------------------------------------------------------------------

  /**
   * Load an Order that (a) belongs to this tenant and (b) actually came from a
   * delivery platform (source set + externalOrderId present). Anything else is
   * an honest 404/400 — we never moderate an internal/POS order through here.
   */
  private async resolvePlatformOrder(
    tenantId: string,
    orderId: string,
  ): Promise<Order> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (!order.source || !order.externalOrderId) {
      throw new BadRequestException(
        `Order ${orderId} is not a delivery-platform order`,
      );
    }
    return order;
  }

  /**
   * Resolve the (decrypted) platform config, ensure a fresh token, get the
   * adapter, and run the caller's platform call. On failure we record the
   * error (log + circuit-breaker) and rethrow — the internal status is never
   * advanced on a fabricated success.
   */
  private async dispatchToPlatform(
    order: Order,
    call: (
      adapter: ReturnType<AdapterFactory["getAdapter"]>,
      config: NonNullable<
        Awaited<ReturnType<DeliveryAuthService["ensureValidToken"]>>
      >,
    ) => Promise<void>,
  ): Promise<void> {
    const platform = order.source!;
    // Decrypted config (throws NotFound if the platform isn't configured /
    // was deleted). findOneInternal is tenant-scoped.
    const baseConfig = await this.configService.findOneInternal(
      order.tenantId,
      platform,
    );
    if (!baseConfig.isEnabled) {
      throw new BadRequestException(
        `${platform} integration is disabled for this tenant`,
      );
    }

    let freshConfig: Awaited<
      ReturnType<DeliveryAuthService["ensureValidToken"]>
    >;
    try {
      freshConfig = await this.authService.ensureValidToken(baseConfig.id);
    } catch (error: any) {
      await this.recordFailure(order, platform, error);
      throw error;
    }
    if (!freshConfig) {
      const err = new BadRequestException(
        `Could not obtain a valid ${platform} access token`,
      );
      await this.recordFailure(order, platform, err);
      throw err;
    }

    const adapter = this.adapterFactory.getAdapter(platform);
    try {
      await call(adapter, freshConfig);
    } catch (error: any) {
      await this.recordFailure(order, platform, error);
      throw error;
    }
  }

  /** Best-effort failure accounting: audit log + circuit-breaker bump. */
  private async recordFailure(order: Order, platform: string, error: any) {
    const message = error?.message ?? String(error);
    this.logger.error(
      `Moderation action failed for ${platform} order ${order.externalOrderId} (tenant ${order.tenantId}): ${message}`,
    );
    await this.logService.log({
      tenantId: order.tenantId,
      branchId: order.branchId,
      platform,
      direction: PlatformLogDirection.OUTBOUND,
      action: PlatformLogAction.STATUS_UPDATE,
      orderId: order.id,
      externalId: order.externalOrderId ?? undefined,
      success: false,
      error: message,
      statusCode: error?.response?.status,
    });
    // Mirror the circuit-breaker bump used by the status-sync/auto-accept
    // paths so a permanently-broken endpoint eventually auto-disables.
    try {
      const config = await this.configService.findOneInternal(
        order.tenantId,
        platform,
      );
      await this.configService.recordError(config.id, `moderation: ${message}`);
    } catch (e: any) {
      this.logger.warn(`recordError failed: ${e.message}`);
    }
  }

  /**
   * Atomic, tenant-scoped status transition. tenantId is in the WHERE
   * (defence-in-depth, same as DeliveryConfigService) so a regression in the
   * resolve step can't write cross-tenant. Returns the fresh row.
   */
  private async transition(
    tenantId: string,
    order: Order,
    data: {
      status?: OrderStatus;
      requiresApproval?: boolean;
      approvedAt?: Date;
      preparingAt?: Date;
      cancelledAt?: Date;
      notes?: string | null;
    },
  ): Promise<Order> {
    const claim = await this.prisma.order.updateMany({
      where: { id: order.id, tenantId },
      data,
    });
    if (claim.count === 0) {
      throw new NotFoundException(`Order ${order.id} not found`);
    }
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  }

  /** Validate prep minutes: positive integer, capped at a sane ceiling. */
  private assertPrepMinutes(minutes: number): number {
    if (
      typeof minutes !== "number" ||
      !Number.isFinite(minutes) ||
      !Number.isInteger(minutes) ||
      minutes <= 0 ||
      minutes > 240
    ) {
      throw new BadRequestException(
        "Prep time must be a whole number of minutes between 1 and 240",
      );
    }
    return minutes;
  }

  /** Append a moderation note to the existing order notes (newline-joined). */
  private appendNote(existing: string | null, note: string): string {
    return [existing, note].filter(Boolean).join("\n");
  }
}
