import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CheckoutService } from "./checkout.service";
import { Cart } from "./checkout.types";

// v2.8.85 — webhook-side settlement for mixed-cart checkouts.
//
// PaytrWebhookController dispatches by merchantOid prefix. The "CK-"
// prefix routes a PayTR callback here:
//   - success: look up CheckoutIntent → call CheckoutService.confirmAnd
//     Provision with the persisted cart → flip status to 'provisioned'.
//   - failure: flip status to 'failed' with the reason. No provisioning.
//
// Idempotency is layered:
//   1. CheckoutIntent.status check — if already 'provisioned' or 'failed',
//      we return without touching anything. PayTR retries up to 4×.
//   2. CheckoutService.confirmAndProvision is independently idempotent
//      on (tenantId, paymentRef). Even if the status check races, the
//      provisioning side won't double-fire.
//
// The reason for the doubled guard: PayTR retries even after a 200 OK if
// the response body wasn't "OK"/"FAIL" — we want a hard guarantee that
// the second retry can't allocate stock or grant entitlements twice,
// independent of the controller's HTTP behaviour.
@Injectable()
export class CheckoutSettlementService {
  private readonly logger = new Logger(CheckoutSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
  ) {}

  async handleSuccess(paymentRef: string, paymentType?: string): Promise<void> {
    const intent = await this.prisma.checkoutIntent.findUnique({
      where: { paymentRef },
    });
    if (!intent) {
      // Unknown OID — log and bail. The webhook controller responds OK so
      // PayTR stops retrying. Returning quietly also avoids leaking which
      // refs exist (mirrors the subscription webhook's posture).
      this.logger.warn(`PayTR success for unknown checkout ref=${paymentRef}`);
      return;
    }
    if (intent.status === "provisioned") {
      this.logger.log(
        `Idempotent PayTR success for ref=${paymentRef} (already provisioned)`,
      );
      return;
    }
    if (intent.status === "failed") {
      // A late "success" overriding a recorded failure is suspicious. PayTR
      // would not normally do this, but if it does we want a paper trail
      // before silently provisioning. Refuse and surface the conflict.
      this.logger.error(
        `PayTR success for ref=${paymentRef} but intent is 'failed'. Refusing to provision.`,
      );
      return;
    }

    // Mark the success first so a second arrival of the same callback hits
    // the idempotency check above instead of starting a parallel
    // provisioning pass. confirmAndProvision is itself idempotent (it
    // catches the (tenant, paymentRef) hit and returns the cached row);
    // this status flip is the cheap first guard.
    await this.prisma.checkoutIntent.updateMany({
      where: { paymentRef, status: "pending" },
      data: { status: "succeeded", succeededAt: new Date() },
    });

    try {
      const result = await this.checkout.confirmAndProvision(
        intent.tenantId,
        intent.cartJson as unknown as Cart,
        paymentRef,
      );
      await this.prisma.checkoutIntent.update({
        where: { paymentRef },
        data: {
          status: "provisioned",
          provisionedAt: new Date(),
          hardwareOrderId: result.hardwareOrderId ?? null,
          addOnIds: result.addOnIds,
        },
      });
      this.logger.log(
        `Provisioned mixed-cart checkout ref=${paymentRef} tenant=${intent.tenantId} hwOrder=${result.hardwareOrderId ?? "none"} addOns=${result.addOnIds.length} paymentType=${paymentType ?? "unknown"}`,
      );
    } catch (err) {
      // Roll back the status flip so a manual retry (or the recovery
      // sweeper, when v2.9.x lands) can re-attempt provisioning. The
      // succeededAt timestamp stays — we know PayTR did charge the card.
      await this.prisma.checkoutIntent.update({
        where: { paymentRef },
        data: { status: "succeeded" },
      });
      this.logger.error(
        `Provisioning failed for ref=${paymentRef} after PayTR success — left in 'succeeded' for retry. err=${(err as Error).message}`,
      );
      throw err;
    }
  }

  async handleFailure(paymentRef: string, reason?: string): Promise<void> {
    const intent = await this.prisma.checkoutIntent.findUnique({
      where: { paymentRef },
      select: { status: true },
    });
    if (!intent) {
      this.logger.warn(`PayTR failure for unknown checkout ref=${paymentRef}`);
      return;
    }
    if (intent.status === "provisioned") {
      // The buyer already got the goods. A late failure callback is the
      // gateway's mistake (or a reordering between concurrent retries).
      // Don't roll back provisioning — log and bail.
      this.logger.error(
        `PayTR failure arrived for already-provisioned ref=${paymentRef}. Ignoring.`,
      );
      return;
    }
    // Truncate the reason at the boundary — vendors sometimes return
    // multi-kilobyte HTML error pages and we don't want those persisted.
    const trimmed = reason ? reason.slice(0, 500) : null;
    await this.prisma.checkoutIntent.updateMany({
      where: { paymentRef, status: { in: ["pending", "succeeded"] } },
      data: {
        status: "failed",
        failureReason: trimmed,
        failedAt: new Date(),
      },
    });
    this.logger.log(
      `Marked checkout ref=${paymentRef} failed: ${trimmed ?? "no reason"}`,
    );
  }
}
