import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { KdsGateway } from '../../kds/kds.gateway';
import { AdapterFactory } from '../adapters/adapter-factory';
import { DeliveryLogService } from './delivery-log.service';
import { DeliveryAuthService } from './delivery-auth.service';
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

    // 1-4. Deduplicate + map items + create order in a transaction
    const createdOrder = await this.prisma.$transaction(async (tx) => {
      // 1. Deduplicate by externalOrderId + platform (idempotent)
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
        return {
          productId: mapping?.productId || null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.quantity * item.unitPrice,
          modifierTotal: (item.modifiers || []).reduce(
            (sum, m) => sum + m.price * m.quantity,
            0,
          ),
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

      // 3. Get platform config for auto-accept setting
      const config = await tx.deliveryPlatformConfig.findUnique({
        where: { tenantId_platform: { tenantId, platform } },
      });

      const autoAccept = config?.autoAccept ?? true;

      // Generate order number
      const orderNumber = `${platform.substring(0, 3)}-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;

      // Calculate totals
      const totalAmount = normalizedOrder.totalAmount;
      const discount = normalizedOrder.discount;
      const finalAmount = normalizedOrder.finalAmount;

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
      const status = autoAccept
        ? OrderStatus.PENDING
        : OrderStatus.PENDING_APPROVAL;

      return tx.order.create({
        data: {
          orderNumber,
          type: 'DELIVERY',
          status,
          requiresApproval: !autoAccept,
          source: platform,
          externalOrderId,
          externalData: normalizedOrder.rawPayload,
          totalAmount,
          discount,
          finalAmount,
          notes: orderNotes || null,
          customerName: normalizedOrder.customerName,
          customerPhone: normalizedOrder.customerPhone,
          tenantId,
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

    // If this was a duplicate, skip post-creation steps
    if (!createdOrder) {
      return null;
    }

    // Get config for auto-accept (outside transaction)
    const config = await this.prisma.deliveryPlatformConfig.findUnique({
      where: { tenantId_platform: { tenantId, platform } },
    });
    const autoAccept = config?.autoAccept ?? true;

    // 5. If autoAccept, also accept on the platform side
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
      }
    }

    // 6. Emit via KDS WebSocket
    this.kdsGateway.emitNewOrder(tenantId, createdOrder);

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
}
