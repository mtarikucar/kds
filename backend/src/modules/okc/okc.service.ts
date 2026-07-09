import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { BranchScope, branchScope } from "../../common/scoping/branch-scope";
import { FiscalReceiptGenerator } from "./fiscal-receipt.generator";
import { OKC_DEVICE, OkcDeviceProvider } from "./okc-device.provider";

/**
 * ÖKC fiscal-receipt flow: order → GMP-3 receipt → print on the configured
 * device. Device-agnostic — the injected OkcDeviceProvider is Mock in dev/test
 * and an SDK-backed adapter in production. The whole path is code-complete and
 * tested via the mock; only the physical device provider is external.
 */
@Injectable()
export class OkcService {
  constructor(
    private prisma: PrismaService,
    private generator: FiscalReceiptGenerator,
    @Inject(OKC_DEVICE) private device: OkcDeviceProvider,
  ) {}

  deviceStatus() {
    return { device: this.device.name, available: this.device.isAvailable() };
  }

  async printOrderReceipt(scope: BranchScope, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...branchScope(scope) },
      include: {
        orderItems: {
          include: { product: { select: { name: true } } },
        },
      },
    });
    if (!order) throw new NotFoundException("Order not found");

    const receipt = this.generator.generate({
      orderNumber: order.orderNumber,
      paymentMethod: (order as any).paymentMethod ?? undefined,
      items: order.orderItems.map((oi: any) => ({
        name: oi.product?.name ?? "Ürün",
        quantity: oi.quantity,
        unitPrice: oi.unitPrice,
        taxRate: oi.taxRate ?? 10,
      })),
    });

    const fiscal = await this.device.print(receipt);
    return { device: this.device.name, receipt, fiscal };
  }
}
