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
 * GMP-3 integrated Yazarkasa-POS — one device charges the card AND prints the
 * mali fiş atomically (fiscal_coupled). A bridge provider: the charge runs
 * through the on-prem agent's `charge_card` queue (NON_RETRYABLE — a lost ack
 * never auto-redelivers, so no double-charge), and `mapAck` maps the agent's
 * outcome once it lands.
 *
 * SCAFFOLDED + GATED: the real vendor SDK binding is hardware-side (P4 bridge
 * handler). A terminal record using this provider stays CONFIGURED_NOT_ACTIVE
 * until certified hardware is paired and an operator activates it, so this
 * never moves real money in its current state.
 */
@Injectable()
export class Gmp3CardTerminalProvider
  implements PaymentTerminalProvider, OnModuleInit
{
  private readonly logger = new Logger(Gmp3CardTerminalProvider.name);
  readonly id = "gmp3_card";
  readonly capabilities: TerminalCapability[] = [
    "sale",
    "void",
    "fiscal_coupled",
    "query_last",
  ];
  readonly kind = "bridge" as const;
  // The protocol profile the bridge dispatches on, and the minimum GMP-3
  // firmware revision required. Overridable per device via terminal.config.
  private readonly vendorProfile = "gmp3.card";
  private readonly sdkVersion = "3.1.0";

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
        // context (lines/KDV/tender/customer) rides along so the device prints
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
          // fiscalNo present ⇒ the device printed the fiş atomically; the
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
