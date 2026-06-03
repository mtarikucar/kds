import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Read-only tenant view over hardware orders. Writes live in
 * CheckoutService (provisioning) and SuperadminShipmentsController
 * (ops). This service exists so the tenant dashboard's "My orders"
 * page never accidentally hits a write path.
 */
@Injectable()
export class HardwareOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(tenantId: string, status?: string) {
    return this.prisma.hardwareOrder.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        items: {
          select: {
            id: true,
            name: true,
            sku: true,
            qty: true,
            unitCents: true,
          },
        },
        shipments: {
          select: {
            id: true,
            carrier: true,
            trackingNo: true,
            status: true,
            shippedAt: true,
            deliveredAt: true,
          },
        },
      },
    });
  }

  async getMine(tenantId: string, id: string) {
    const row = await this.prisma.hardwareOrder.findFirst({
      where: { id, tenantId },
      include: {
        items: true,
        shipments: true,
        installations: true,
      },
    });
    if (!row) throw new NotFoundException("Order not found");
    return row;
  }
}
