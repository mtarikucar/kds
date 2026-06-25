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
 * External bank POS over ECR/OOS (Ödeme Onaylı Sistem) — a standalone bank
 * terminal connected to the on-prem agent. CHARGE-ONLY: it is NOT
 * fiscal_coupled, so after an APPROVED charge the standard yazarkasa/e-Fatura
 * rail issues the mali fiş (the coupled-fiş guard does NOT fire — no fiscalNo).
 *
 * A bridge provider: charges route through the device-mesh `charge_card` queue
 * (NON_RETRYABLE). The vendor ECR socket binding is hardware-side (P4); until a
 * device is paired and a bridge handler installed, charges simply time out
 * (fail-closed — no Payment recorded).
 */
@Injectable()
export class BankEcrTerminalProvider
  implements PaymentTerminalProvider, OnModuleInit
{
  private readonly logger = new Logger(BankEcrTerminalProvider.name);
  readonly id = "bank_ecr";
  readonly capabilities: TerminalCapability[] = ["sale", "void", "query_last"];
  readonly kind = "bridge" as const;
  private readonly vendorProfile = "bank.ecr";

  constructor(private readonly registry: PaymentTerminalProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  buildSaleCommand(req: TerminalChargeRequest): TerminalSaleCommand {
    const cfg = req.terminal.config ?? {};
    return {
      kind: "charge_card",
      payload: {
        protocol: "ECR",
        vendorProfile: (cfg.vendorProfile as string) ?? this.vendorProfile,
        terminalSerial: req.terminal.serial,
        tenantId: req.tenantId,
        branchId: req.branchId ?? null,
        orderId: req.orderId,
        amountCents: req.amountCents,
        currency: "TRY",
        // charge-only: no fiscal context — the fiş is issued separately by the
        // yazarkasa/e-Fatura rail after the Payment is recorded.
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
      // Approve ONLY on an explicit positive signal (a Payment is booked on
      // APPROVED). Explicit refusal → DECLINED; anything else → ERROR.
      if (r.approved === true) {
        return {
          status: "APPROVED",
          approvalCode: (r.approvalCode as string) ?? undefined,
          rrn: (r.rrn as string) ?? undefined,
          cardBrand: (r.cardBrand as string) ?? undefined,
          maskedPan: (r.maskedPan as string) ?? undefined,
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
    return { status: "ERROR", error: ack.error ?? "Terminal error" };
  }
}
