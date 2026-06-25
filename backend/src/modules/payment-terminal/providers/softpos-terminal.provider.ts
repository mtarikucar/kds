import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PaymentTerminalProviderRegistry } from "../payment-terminal-provider.registry";
import {
  PaymentTerminalProvider,
  TerminalCapability,
  TerminalChargeRequest,
  TerminalChargeResult,
} from "../payment-terminal-provider.interface";

/**
 * SoftPOS / PSP terminal over a cloud HTTP API (NFC phone-as-POS, or a PSP that
 * exposes a charge endpoint). CHARGE-ONLY and IN-PROCESS: the backend would call
 * the PSP directly. NOT fiscal_coupled, so the yazarkasa/e-Fatura rail issues
 * the fiş afterwards.
 *
 * SCAFFOLDED — `activatable = false`: there is no real PSP HTTP client wired
 * yet, so the activation gate REFUSES flipping a SoftPOS terminal to ACTIVE
 * (the honest CONFIGURED_NOT_ACTIVE boundary). Even if it were resolved,
 * `charge` is fail-closed: it returns ERROR rather than fabricate an approval,
 * so it can never move real money in its current state.
 */
@Injectable()
export class SoftPosTerminalProvider
  implements PaymentTerminalProvider, OnModuleInit
{
  private readonly logger = new Logger(SoftPosTerminalProvider.name);
  readonly id = "softpos";
  readonly capabilities: TerminalCapability[] = [
    "sale",
    "refund",
    "query_last",
  ];
  readonly kind = "in_process" as const;
  // No real PSP HTTP integration is wired → cannot be ACTIVE (fail-closed).
  readonly activatable = false;

  constructor(private readonly registry: PaymentTerminalProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async charge(req: TerminalChargeRequest): Promise<TerminalChargeResult> {
    // Fail-closed: no real PSP client exists yet. Never fabricate an approval —
    // return ERROR so no Payment is recorded. Real HTTP wiring lands in P4.
    this.logger.warn(
      `SoftPOS charge requested for order ${req.orderId} but no PSP integration is wired — refusing (fail-closed).`,
    );
    return {
      status: "ERROR",
      error: "SoftPOS PSP integration is not available yet",
    };
  }
}
