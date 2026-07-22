import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ErrorCode } from "../../common/interfaces/error-response.interface";
import { DEMO_PLAN_NAME } from "./demo.constants";

/**
 * Minimal, cycle-safe guard against real-money initiation for the single
 * shared "explore demo" tenant. Depends ONLY on PrismaService (no other
 * module services) so it can be dropped into any payment-adjacent module
 * (Payments, Subscriptions, Checkout, CustomerOrders) without risking a
 * NestJS circular-dependency cycle — see DemoGuardModule.
 *
 * The demo tenant (DemoService.ensureDemoTenant) is seeded onto a
 * SubscriptionPlan named DEMO_PLAN_NAME. A visitor exploring that tenant
 * gets a fully-privileged normal ADMIN session (only difference from a real
 * login: no refresh token), so ordinary UI navigation can otherwise reach a
 * REAL PayTR iframe using the platform's real merchant credentials. This is
 * the single source of truth blocking that at the backend — every money
 * entry point (subscription change-plan/checkout, marketplace/hardware
 * checkout, QR self-pay) calls assertNotDemo before doing any PayTR /
 * bank-transfer / provisioning work.
 */
@Injectable()
export class DemoGuardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * True when the tenant's current plan is the internal DEMO plan. Fails
   * OPEN (returns false) when the tenant can't be resolved — an unknown
   * tenantId will fail later for other reasons (NotFoundException etc.) and
   * this guard's job is only to positively identify the demo tenant, not to
   * validate tenant existence.
   */
  async isDemoTenant(tenantId: string): Promise<boolean> {
    if (!tenantId) return false;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { currentPlan: { select: { name: true } } },
    });
    return tenant?.currentPlan?.name === DEMO_PLAN_NAME;
  }

  /**
   * Throws a 403 DEMO_PAYMENT_BLOCKED when `tenantId` resolves to the demo
   * tenant. Call this as the very first statement of any method that would
   * otherwise reserve a payment row, call PayTR/bank-transfer, or provision
   * paid entitlements.
   */
  async assertNotDemo(tenantId: string): Promise<void> {
    if (await this.isDemoTenant(tenantId)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Demo Payment Blocked",
        errorCode: ErrorCode.DEMO_PAYMENT_BLOCKED,
        message: "Demo modunda ödeme alınamaz.",
      });
    }
  }
}
