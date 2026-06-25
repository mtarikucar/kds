import { Injectable } from "@nestjs/common";
import {
  PaymentTerminalProvider,
  TerminalChargeRequest,
  TerminalChargeResult,
} from "../payment-terminal-provider.interface";

/**
 * Fail-closed SIMULATOR terminal. In-process, deterministic — NEVER moves real
 * money. Used end-to-end so the whole charge→record→fiş→recovery rail is
 * testable without certified hardware. Outcome is driven by the terminal
 * record's config so QA can exercise approve / decline / error paths:
 *
 *   config.outcome: "APPROVE" (default) | "DECLINE" | "ERROR"
 *   config.declineEveryCents: if amountCents === this, force DECLINE (handy
 *                             for deterministic decline tests)
 *
 * A real charge can NEVER come from this provider — a PaymentTerminalRecord
 * using it is marked activationState=SIMULATOR and the operator UI labels it
 * as test mode.
 */
@Injectable()
export class SimulatorTerminalProvider implements PaymentTerminalProvider {
  readonly id = "simulator";
  readonly capabilities = ["sale", "void", "refund"] as const as any;
  readonly kind = "in_process" as const;

  async charge(req: TerminalChargeRequest): Promise<TerminalChargeResult> {
    const cfg = req.terminal.config ?? {};
    const outcome = String((cfg as any).outcome ?? "APPROVE").toUpperCase();
    const declineEveryCents = Number((cfg as any).declineEveryCents ?? NaN);

    if (outcome === "ERROR") {
      return { status: "ERROR", error: "Simulated terminal error" };
    }
    if (
      outcome === "DECLINE" ||
      (Number.isFinite(declineEveryCents) &&
        declineEveryCents === req.amountCents)
    ) {
      return { status: "DECLINED", error: "Simulated card decline" };
    }

    // Deterministic, clearly-fake approval reference (SIM- prefix so it can
    // never be confused with a real bank RRN/approval code).
    const ref = `SIM-${req.idempotencyKey.slice(0, 12)}`;
    return {
      status: "APPROVED",
      approvalCode: ref,
      rrn: ref,
      cardBrand: "SIMULATOR",
      maskedPan: "**** **** **** 0000",
      raw: { simulator: true, amountCents: req.amountCents },
    };
  }
}
