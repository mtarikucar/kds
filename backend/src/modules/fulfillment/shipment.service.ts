import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { CatalogService } from '../catalog/catalog.service';

/**
 * Shipment + warranty + installation orchestration for hardware orders.
 *
 * The MVP carrier is `manual` — operations staff paste a tracking number
 * from the carrier's portal. Phase 10 adds carrier adapters (Yurtiçi, Aras,
 * MNG) that auto-create labels and pull delivery webhooks. The shape stays
 * the same; only the source of `trackingNo` changes.
 */
@Injectable()
export class ShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly catalog: CatalogService,
  ) {}

  /** Create a shipment for an order. Marks order status=shipped. */
  async createShipment(hardwareOrderId: string, input: { carrier: string; trackingNo?: string; meta?: Record<string, unknown> }) {
    const order = await this.prisma.hardwareOrder.findUnique({
      where: { id: hardwareOrderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Hardware order not found');
    if (order.status !== 'paid' && order.status !== 'fulfillment') {
      throw new BadRequestException(`Cannot ship from status=${order.status}`);
    }

    const shipment = await this.prisma.shipment.create({
      data: {
        id: uuidv7(),
        orderId: hardwareOrderId,
        carrier: input.carrier,
        trackingNo: input.trackingNo,
        status: input.trackingNo ? 'in_transit' : 'pending',
        shippedAt: input.trackingNo ? new Date() : null,
        meta: input.meta as any,
      },
    });

    // Inventory accounting: allocated → shipped, per line.
    for (const item of order.items) {
      await this.catalog.markShipped(item.productId, item.qty);
    }

    await this.prisma.hardwareOrder.update({
      where: { id: hardwareOrderId },
      data: { status: input.trackingNo ? 'shipped' : 'fulfillment' },
    });

    await this.outbox
      .append({
        type: 'hardware.order.shipped.v1',
        tenantId: order.tenantId,
        payload: { orderId: hardwareOrderId, shipmentId: shipment.id, carrier: input.carrier, trackingNo: input.trackingNo },
      })
      .catch(() => undefined);

    return shipment;
  }

  /** Carrier webhook → mark shipment delivered. Idempotent on shipment+status. */
  async markDelivered(shipmentId: string) {
    const s = await this.prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!s) throw new NotFoundException('Shipment not found');
    if (s.status === 'delivered') return s;

    const updated = await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: { status: 'delivered', deliveredAt: new Date() },
    });
    const order = await this.prisma.hardwareOrder.update({
      where: { id: s.orderId },
      data: { status: 'delivered' },
    });

    await this.outbox
      .append({
        type: 'hardware.order.delivered.v1',
        tenantId: order.tenantId,
        payload: { orderId: order.id, shipmentId },
      })
      .catch(() => undefined);

    return updated;
  }

  listForOrder(hardwareOrderId: string) {
    return this.prisma.shipment.findMany({ where: { orderId: hardwareOrderId }, orderBy: { id: 'asc' } });
  }
}
