import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { PrismaService } from "../../../prisma/prisma.service";
import { DeliveryConfigService } from "./delivery-config.service";
import { DeliveryOrderService } from "./delivery-order.service";
import { DeliveryPlatform } from "../constants/platform.enum";
import {
  NormalizedOrder,
  NormalizedOrderItem,
} from "../interfaces/platform-order.interface";

/**
 * Built-in test-order simulator.
 *
 * A tenant who has never wired a live platform account can still validate the
 * full pipeline — webhook/poll ingest → Order creation → KDS emit →
 * auto-accept → status — by firing a synthetic, clearly-labelled order through
 * the SAME {@link DeliveryOrderService.processIncomingOrder} that real
 * webhooks use. Nothing about the downstream path is special-cased, so a green
 * simulator run is real evidence the production path works.
 *
 * Guard rails (a fake order must never reach a real platform or be mistaken
 * for a paying customer's order):
 *   1. The platform's DeliveryPlatformConfig.environment MUST be "sandbox".
 *      We refuse on a "production" config so a synthetic order can never be
 *      injected into — and then auto-accepted/pushed back to — a live
 *      platform integration.
 *   2. The order is stamped TEST-<random> as its externalOrderId and carries a
 *      loud note, so the kitchen, the dedup key, and any operator scanning the
 *      DB can tell it apart from a genuine order.
 */
@Injectable()
export class DeliveryTestService {
  private readonly logger = new Logger(DeliveryTestService.name);

  constructor(
    private prisma: PrismaService,
    private configService: DeliveryConfigService,
    private orderService: DeliveryOrderService,
  ) {}

  /**
   * Build a realistic synthetic NormalizedOrder for `platform` and run it
   * through the real ingest path. Returns the created Order (or null if the
   * order pipeline declined it — e.g. no active branch / dedup).
   *
   * REFUSES unless the platform's config exists and is sandbox-environment.
   */
  async simulateOrder(tenantId: string, platform: string) {
    if (
      !Object.values(DeliveryPlatform).includes(platform as DeliveryPlatform)
    ) {
      throw new BadRequestException(`Unknown delivery platform: ${platform}`);
    }

    // findOneInternal throws NotFoundException when there is no config row, so
    // a tenant can't simulate against a platform they've never set up.
    const config = await this.configService.findOneInternal(tenantId, platform);

    // GUARD RAIL #1: sandbox-only. Never inject a synthetic order into a
    // production-configured platform — auto-accept would push a fake order
    // back to the live platform and the kitchen could ship phantom food.
    if (config.environment !== "sandbox") {
      throw new BadRequestException(
        `Test orders are only allowed when ${platform} is configured for the "sandbox" environment ` +
          `(current: "${config.environment ?? "production"}"). Switch the platform to sandbox before simulating.`,
      );
    }

    const normalizedOrder = await this.buildSyntheticOrder(tenantId, platform);

    this.logger.log(
      `Simulating ${platform} test order ${normalizedOrder.externalOrderId} for tenant ${tenantId} (sandbox)`,
    );

    return this.orderService.processIncomingOrder(tenantId, normalizedOrder);
  }

  /**
   * Construct a believable order: prefer up to two of the tenant's already
   * mapped menu items (so the order lands with real KDS line items), and fall
   * back to clearly-labelled "TEST" items when the tenant has no mappings yet.
   * Totals are computed from the line items so the order-service totals sanity
   * check passes.
   */
  private async buildSyntheticOrder(
    tenantId: string,
    platform: string,
  ): Promise<NormalizedOrder> {
    // Reuse existing mappings so the synthetic order exercises real
    // item-mapping + KDS line rendering. Cap at two for a believable basket.
    const mappings = await this.prisma.menuItemMapping.findMany({
      where: { tenantId, platform, isActive: true },
      include: {
        product: { select: { name: true, price: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 2,
    });

    let items: NormalizedOrderItem[];
    if (mappings.length > 0) {
      items = mappings.map((m, idx) => ({
        externalItemId: m.externalItemId,
        name: `[TEST] ${m.product.name}`,
        quantity: idx === 0 ? 2 : 1,
        unitPrice: this.round2(Number(m.product.price)),
      }));
    } else {
      // No mappings — emit unmistakably-labelled TEST items with realistic
      // prices. These won't map to internal products, so the order lands as
      // PENDING_APPROVAL with the items captured in the notes (existing
      // unmapped-order behaviour), which is exactly the surface a first-time
      // tenant wants to see.
      items = [
        {
          externalItemId: "TEST-ITEM-1",
          name: "[TEST] Cheeseburger Menu",
          quantity: 2,
          unitPrice: 149.9,
          notes: "Synthetic test item — not a real product",
        },
        {
          externalItemId: "TEST-ITEM-2",
          name: "[TEST] Ayran",
          quantity: 1,
          unitPrice: 24.5,
        },
      ];
    }

    const itemsSum = items.reduce(
      (sum, it) => sum + this.round2(it.unitPrice * it.quantity),
      0,
    );
    const totalAmount = this.round2(itemsSum);
    const discount = 0;
    const finalAmount = this.round2(totalAmount - discount);

    // GUARD RAIL #2: a loud, deterministic TEST- prefix on the external id
    // (which is also the dedup key) plus an explicit note. The order can't be
    // confused with a real one and acceptOrder targets a TEST- id the sandbox
    // platform never issued.
    const externalOrderId = `TEST-${crypto.randomUUID()}`;

    return {
      platform: platform as DeliveryPlatform,
      externalOrderId,
      customerName: "Test Müşteri (Simülasyon)",
      customerPhone: "+905555555555",
      customerAddress: "Test Mahallesi, Simülasyon Sok. No:1, İstanbul",
      notes:
        "⚠️ TEST ORDER — generated by the built-in delivery simulator. " +
        "Do not fulfil. Safe to cancel.",
      items,
      totalAmount,
      discount,
      finalAmount,
      rawPayload: {
        __test: true,
        simulator: "delivery-test-service",
        platform,
        generatedAt: new Date().toISOString(),
      },
      createdAt: new Date(),
    };
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
