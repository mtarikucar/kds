import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { KdsGateway } from '../../kds/kds.gateway';
import { AdapterFactory } from '../adapters/adapter-factory';
import { DeliveryLogService } from './delivery-log.service';
import { DeliveryAuthService } from './delivery-auth.service';
import { DeliveryConfigService } from './delivery-config.service';
import { NormalizedOrder } from '../interfaces/platform-order.interface';
import { PlatformLogDirection, PlatformLogAction } from '../constants/platform.enum';
import { OrderStatus } from '../../../common/constants/order-status.enum';

@Injectable()
export class DeliveryOrderService {
  private readonly logger = new Logger(DeliveryOrderService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => KdsGateway))
    private kdsGateway: KdsGateway,
    private adapterFactory: AdapterFactory,
    private logService: DeliveryLogService,
    private authService: DeliveryAuthService,
    private configService: DeliveryConfigService,
  ) {}

  /**
   * Process an incoming order from a delivery platform.
   * This is the heart of the system — handles deduplication, item mapping,
   * order creation, auto-accept, and WebSocket emission.
   */
  async processIncomingOrder(
    tenantId: string,
    normalizedOrder: NormalizedOrder,
  ) {
    const { platform, externalOrderId } = normalizedOrder;

    // Read config ONCE up front so the inside-txn `requiresApproval`
    // decision and the outside-txn platform-side accept decision use
    // the same snapshot. The earlier code re-read the config after
    // commit; if an admin toggled autoAccept in the few ms in between,
    // the order would be persisted as PENDING (autoAccept=true) but
    // the platform-side acceptOrder call would skip (autoAccept=false),
    // leaving the order in-kitchen while the platform thought it was
    // unaccepted.
    const config = await this.prisma.deliveryPlatformConfig.findUnique({
      where: { tenantId_platform: { tenantId, platform } },
    });
    const autoAccept = config?.isEnabled ? (config.autoAccept ?? false) : false;

    // v3.0.0 — branchId is now NOT NULL on Order. Delivery orders come
    // from an external platform without an inherent branch, so we resolve
    // to the tenant's first active branch (ordered by creation) as a
    // deterministic fallback. Multi-branch tenants that want platform
    // orders routed elsewhere will need a per-platform branch mapping in
    // a future iteration.
    const fallbackBranch = await this.prisma.branch.findFirst({
      where: { tenantId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!fallbackBranch) {
      this.logger.warn(
        `No active branch for tenant ${tenantId} — cannot persist ${platform} order ${externalOrderId}`,
      );
      return null;
    }
    const branchId = fallbackBranch.id;

    // 1-4. Deduplicate + map items + create order in a transaction.
    // Final dedup guarantee is the partial unique index
    // orders(tenantId, source, externalOrderId) — the findFirst below is
    // a fast-path; the try/catch on P2002 handles concurrent webhooks.
    let createdOrder;
    try {
      createdOrder = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({
        where: {
          tenantId,
          source: platform,
          externalOrderId,
        },
      });

      if (existing) {
        this.logger.debug(
          `Duplicate order skipped: ${platform} ${externalOrderId}`,
        );
        return null;
      }

      // 2. Map platform items to internal products via MenuItemMapping
      const itemMappings = await tx.menuItemMapping.findMany({
        where: {
          tenantId,
          platform,
          externalItemId: {
            in: normalizedOrder.items.map((i) => i.externalItemId),
          },
          isActive: true,
        },
        include: { product: true },
      });

      const mappingByExternalId = new Map(
        itemMappings.map((m) => [m.externalItemId, m]),
      );

      // Build order items - map to internal products when possible
      const orderItems = normalizedOrder.items.map((item) => {
        const mapping = mappingByExternalId.get(item.externalItemId);
        const modifierTotal = (item.modifiers || []).reduce(
          (sum, m) => sum + m.price * m.quantity,
          0,
        );
        return {
          productId: mapping?.productId || null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.quantity * item.unitPrice + modifierTotal,
          modifierTotal,
          notes: item.notes
            ? `${item.name}${mapping ? '' : ' (unmapped)'}: ${item.notes}`
            : !mapping
              ? `${item.name} (unmapped)`
              : undefined,
        };
      });

      // Filter items - we need valid product mappings for order items
      const validItems = orderItems.filter((item) => item.productId !== null);

      const unmappedCount = normalizedOrder.items.length - validItems.length;
      if (validItems.length === 0) {
        this.logger.warn(
          `No mapped items (${unmappedCount} unmapped) for ${platform} order ${externalOrderId} in tenant ${tenantId}. ` +
            `Storing order with notes.`,
        );
      }

      // Config + autoAccept were resolved before the txn (iter-39) so
      // the inside-txn decision and the outside-txn platform-accept
      // decision agree on the same snapshot.

      // Generate order number
      const orderNumber = `${platform.substring(0, 3)}-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;

      // Calculate totals
      const totalAmount = normalizedOrder.totalAmount;
      const discount = normalizedOrder.discount;
      const finalAmount = normalizedOrder.finalAmount;

      // Sanity-check the platform-supplied totals against the sum of items.
      // The platform sends finalAmount straight from its own ledger, so a
      // platform-side bug or compromise could silently overcharge customers.
      // Drift > 5% (or > 1₺ absolute on small orders) gates the order into
      // approval-required so a human reviews before fulfilling.
      const itemsSum = normalizedOrder.items.reduce(
        (sum, it) => sum + Number(it.unitPrice) * Number(it.quantity),
        0,
      );
      const claimedSubtotal = Number(totalAmount) - Number(discount ?? 0);
      const drift = Math.abs(itemsSum - claimedSubtotal);
      const tolerance = Math.max(1.0, claimedSubtotal * 0.05);
      const totalsMismatch = drift > tolerance;
      if (totalsMismatch) {
        this.logger.warn(
          `Totals mismatch for ${platform} order ${externalOrderId}: items Σ=${itemsSum.toFixed(2)} vs claimed subtotal ${claimedSubtotal.toFixed(2)} (drift ${drift.toFixed(2)} > tolerance ${tolerance.toFixed(2)}). Forcing approval.`,
        );
      }

      // Build notes with platform info and unmapped items
      const unmappedItems = normalizedOrder.items.filter(
        (item) => !mappingByExternalId.has(item.externalItemId),
      );
      const orderNotes = [
        normalizedOrder.notes,
        normalizedOrder.customerAddress
          ? `Adres: ${normalizedOrder.customerAddress}`
          : null,
        unmappedItems.length > 0
          ? `[UNMAPPED - needs menu mapping]\n${unmappedItems.map((i) => `  - ${i.name} x${i.quantity} @ ${i.unitPrice.toFixed(2)}`).join('\n')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n');

      // 4. Create order
      // Also force approval when items are unmapped (a zero-line-item
      // order with autoAccept=true would otherwise pass at the platform
      // total with no kitchen-visible items) or when totals drift.
      const requiresApproval =
        !autoAccept || unmappedItems.length > 0 || totalsMismatch;
      const status = requiresApproval
        ? OrderStatus.PENDING_APPROVAL
        : OrderStatus.PENDING;

      return tx.order.create({
        data: {
          orderNumber,
          type: 'DELIVERY',
          status,
          requiresApproval,
          source: platform,
          externalOrderId,
          // Raw payload stored for debugging, but PII (customer
          // name/phone/address) lives in dedicated columns already —
          // scrub it from the blob so log retention doesn't double as
          // long-term PII storage.
          externalData: this.logService.scrubPii(normalizedOrder.rawPayload) as any,
          totalAmount,
          discount,
          finalAmount,
          notes: orderNotes || null,
          customerName: normalizedOrder.customerName,
          customerPhone: normalizedOrder.customerPhone,
          tenantId,
          branchId,
          orderItems: {
            create: validItems.map((item) => ({
              productId: item.productId!,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: item.subtotal,
              modifierTotal: item.modifierTotal,
              notes: item.notes,
            })),
          },
        },
        include: {
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  image: true,
                },
              },
            },
          },
          table: {
            select: {
              id: true,
              number: true,
              section: true,
            },
          },
        },
      });
    });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Concurrent webhook delivery — DB uniqueness caught the race
        // we couldn't catch with findFirst + create. Idempotent outcome.
        this.logger.debug(
          `Duplicate order skipped (DB race): ${platform} ${externalOrderId}`,
        );
        return null;
      }
      throw err;
    }

    if (!createdOrder) {
      return null;
    }

    // 5. If autoAccept, also accept on the platform side. Config +
    // autoAccept were resolved once before the txn (iter-39) — same
    // snapshot drove both `requiresApproval` and this branch.
    if (autoAccept && config) {
      try {
        const freshConfig = await this.authService.ensureValidToken(config.id);
        if (freshConfig) {
          const adapter = this.adapterFactory.getAdapter(platform);
          await adapter.acceptOrder(freshConfig, externalOrderId);

          await this.logService.log({
            tenantId,
            platform,
            direction: PlatformLogDirection.OUTBOUND,
            action: PlatformLogAction.ORDER_ACCEPTED,
            orderId: createdOrder.id,
            externalId: externalOrderId,
            success: true,
          });
        }
      } catch (error: any) {
        this.logger.error(
          `Failed to auto-accept order ${externalOrderId} on ${platform}: ${error.message}`,
        );
        await this.logService.log({
          tenantId,
          platform,
          direction: PlatformLogDirection.OUTBOUND,
          action: PlatformLogAction.ORDER_ACCEPTED,
          orderId: createdOrder.id,
          externalId: externalOrderId,
          success: false,
          error: error.message,
          nextRetryAt: new Date(Date.now() + 30_000),
        });

        // Circuit-breaker parity with iter-38 (menu/status sync). A
        // platform whose acceptOrder endpoint is permanently broken
        // (wrong API version, dropped credentials) would otherwise
        // loop forever — every webhook bumps the retry queue but the
        // config never auto-disables at CIRCUIT_BREAKER_THRESHOLD.
        await this.configService.recordError(config.id, `accept_order: ${error.message}`)
          .catch((e) => this.logger.warn(`recordError failed: ${e.message}`));
      }
    }

    // 6. Emit via KDS WebSocket
    this.kdsGateway.emitNewOrder(tenantId, createdOrder.branchId, createdOrder);

    // 7. Log the inbound order
    await this.logService.log({
      tenantId,
      platform,
      direction: PlatformLogDirection.INBOUND,
      action: PlatformLogAction.ORDER_RECEIVED,
      orderId: createdOrder.id,
      externalId: externalOrderId,
      success: true,
    });

    this.logger.log(
      `Order created from ${platform}: ${createdOrder.orderNumber} (${externalOrderId})`,
    );

    return createdOrder;
  }

  /**
   * Apply a platform-driven status update (e.g. courier picked up the
   * order, customer cancelled). Until 2026-05-11 the Yemeksepeti webhook
   * handler logged these and returned 200 without writing — delivered
   * orders sat in KDS as READY forever. The mapping here is intentionally
   * narrow: PICKED_UP / DELIVERED → SERVED (kitchen has handed off);
   * CANCELLED / REJECTED → CANCELLED (kitchen stop). Anything else logs
   * and ignores (a no-op is safer than guessing).
   */
  async applyPlatformStatusUpdate(args: {
    platform: string;
    remoteOrderId: string;
    tenantId: string;
    platformStatus: string | undefined | null;
  }): Promise<{ matched: boolean; mappedTo?: OrderStatus }> {
    const { platform, remoteOrderId, tenantId, platformStatus } = args;
    if (!platformStatus) {
      this.logger.warn(
        `Platform status update without status field: ${platform} ${remoteOrderId}`,
      );
      return { matched: false };
    }

    const normalized = String(platformStatus).toLowerCase().replace(/[\s_-]/g, '');
    let target: OrderStatus | null = null;
    if (
      ['pickedup', 'delivered', 'completed', 'finished'].includes(normalized)
    ) {
      target = OrderStatus.SERVED;
    } else if (
      ['cancelled', 'canceled', 'rejected', 'failed'].includes(normalized)
    ) {
      target = OrderStatus.CANCELLED;
    }

    if (!target) {
      this.logger.debug(
        `Ignoring unmapped ${platform} status '${platformStatus}' for order ${remoteOrderId}`,
      );
      return { matched: false };
    }

    // Atomic claim. Filter on (tenantId, source, externalOrderId) plus a
    // status NOT IN [target, terminal-others] so a duplicate webhook
    // delivery doesn't bounce a CANCELLED order back to SERVED.
    const result = await this.prisma.order.updateMany({
      where: {
        tenantId,
        source: platform,
        externalOrderId: remoteOrderId,
        status: { notIn: [target, OrderStatus.PAID, OrderStatus.CANCELLED] },
      },
      data: {
        status: target,
        ...(target === OrderStatus.CANCELLED ? { cancelledAt: new Date() } : {}),
      },
    });

    if (result.count === 0) {
      this.logger.debug(
        `Status update no-op for ${platform} ${remoteOrderId}: order already in terminal state or not found`,
      );
      return { matched: false, mappedTo: target };
    }

    // Notify KDS so the kitchen view reflects the transition immediately.
    const order = await this.prisma.order.findFirst({
      where: { tenantId, source: platform, externalOrderId: remoteOrderId },
    });
    if (order) {
      this.kdsGateway.emitNewOrder(tenantId, order.branchId, order);
    }

    await this.logService.log({
      tenantId,
      platform: platform as any,
      direction: PlatformLogDirection.INBOUND,
      action: PlatformLogAction.STATUS_UPDATE,
      orderId: order?.id,
      externalId: remoteOrderId,
      request: { platformStatus, mappedTo: target },
      success: true,
    });

    return { matched: true, mappedTo: target };
  }
}
