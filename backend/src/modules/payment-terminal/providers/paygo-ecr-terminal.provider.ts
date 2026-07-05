import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PaymentTerminalProviderRegistry } from "../payment-terminal-provider.registry";
import {
  PaymentTerminalProvider,
  TerminalCapability,
  TerminalChargeRequest,
  TerminalChargeResult,
  TerminalSaleCommand,
} from "../payment-terminal-provider.interface";

/**
 * Paygo SP630PRO ECR — a Token/Paygo *Yeni Nesil ÖKC* that charges the card AND
 * prints the mali fiş atomically in one device op (`fiscal_coupled`). This is the
 * FIRST concrete GMP-3 vendor binding on the payment-terminal rail; it mirrors the
 * generic `gmp3_card` scaffold but pins the vendor profile the on-prem bridge
 * dispatches on (`paygo.sp630`) so the bridge's vendor-neutral `gmp3` driver loads
 * the Paygo profile.
 *
 * A bridge provider: the charge runs through the on-prem agent's `charge_card`
 * queue (NON_RETRYABLE — a lost ack never auto-redelivers, so no double-charge),
 * and `mapAck` maps the agent's outcome once it lands. Because the SP630 prints
 * the fiş in the same op, an APPROVED ack carries `fiscalNo`; the
 * PaymentFinalizer coupled-fiş guard then skips the standalone yazarkasa rail so
 * there is no double-fiş.
 *
 * INERT until Phase 1: `activatable=false` — the real GMP-3 cert-handshake driver
 * is hardware-side and needs the Token SDK + a certified device + written pairing
 * authorization. Until that lands the activation gate REFUSES `ACTIVE`
 * (payment-terminal.service `setActivation`), so a record using this provider can
 * only sit `CONFIGURED_NOT_ACTIVE` and `resolveTerminal` never selects it — this
 * provider cannot move real money in its current state. The whole POS
 * charge→record→fiş→recovery rail is instead exercised end-to-end through the
 * dedicated `simulator` provider and the bridge's own simulator mode.
 */
@Injectable()
export class PaygoEcrTerminalProvider
  implements PaymentTerminalProvider, OnModuleInit
{
  private readonly logger = new Logger(PaygoEcrTerminalProvider.name);
  readonly id = "paygo_ecr";
  readonly capabilities: TerminalCapability[] = [
    "sale",
    "void",
    "fiscal_coupled",
    "query_last",
  ];
  readonly kind = "bridge" as const;
  // Not activatable yet — the real Paygo/Token GMP-3 handshake is not certified.
  // Flip to remove this line (default = activatable) once Phase 1 lands.
  readonly activatable = false;

  // The protocol profile the bridge's `gmp3` driver dispatches on to load the
  // Paygo SP630 vendor profile, and the GMP-3 revision the device reports.
  // Both overridable per device via terminal.config.
  private readonly vendorProfile = "paygo.sp630";
  private readonly sdkVersion = "3.2.1";

  constructor(private readonly registry: PaymentTerminalProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  buildSaleCommand(req: TerminalChargeRequest): TerminalSaleCommand {
    const cfg = req.terminal.config ?? {};
    return {
      kind: "charge_card",
      payload: {
        protocol: "GMP3",
        vendorProfile: (cfg.vendorProfile as string) ?? this.vendorProfile,
        sdkVersion: (cfg.sdkVersion as string) ?? this.sdkVersion,
        fiscalSerial: req.terminal.serial,
        tenantId: req.tenantId,
        branchId: req.branchId ?? null,
        orderId: req.orderId,
        amountCents: req.amountCents,
        currency: "TRY",
        // GMP-3 charges the card AND prints the fiş in one op — the fiscal
        // context (lines/KDV/tender/customer) rides along so the SP630 prints
        // the same fiş the standalone yazarkasa rail would.
        fiscal: req.fiscalContext ?? null,
      },
      idempotencyKey: req.idempotencyKey,
      priority: 10,
    };
  }

  mapAck(ack: {
    status: string;
    result: Record<string, unknown> | null;
    error: string | null;
  }): TerminalChargeResult {
    if (ack.status === "done") {
      const r = ack.result ?? {};
      // Approve ONLY on an explicit positive signal — a Payment is recorded on
      // APPROVED, so a malformed/ambiguous ack (approved missing) must never
      // book money. Explicit refusal → DECLINED (card leg ran, bank declined;
      // no fiş printed). Anything else → ERROR (order stays open, no Payment).
      if (r.approved === true) {
        return {
          status: "APPROVED",
          approvalCode: (r.approvalCode as string) ?? undefined,
          rrn: (r.rrn as string) ?? undefined,
          cardBrand: (r.cardBrand as string) ?? undefined,
          maskedPan: (r.maskedPan as string) ?? undefined,
          // fiscalNo present ⇒ the SP630 printed the fiş atomically; the
          // standalone yazarkasa rail then skips (coupled-fiş guard).
          fiscalNo: (r.fiscalNo as string) ?? undefined,
          raw: r,
        };
      }
      if (r.approved === false) {
        return {
          status: "DECLINED",
          error: (r.error as string) ?? ack.error ?? "Card declined",
          raw: r,
        };
      }
      return {
        status: "ERROR",
        error:
          (r.error as string) ?? ack.error ?? "Terminal ack missing approval",
        raw: r,
      };
    }
    if (ack.status === "expired") {
      return { status: "TIMEOUT", error: ack.error ?? "Terminal timed out" };
    }
    // failed (NON_RETRYABLE — terminal, never auto-redelivered)
    return { status: "ERROR", error: ack.error ?? "Terminal error" };
  }
}
