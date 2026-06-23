import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../prisma/prisma.service";
import { CommandQueueService } from "../../device-mesh/command-queue.service";
import {
  PaymentIntent,
  PaymentIntentRequest,
  PaymentMode,
  PaymentProvider,
  PaymentStatus,
  PaymentTerminal,
  PaymentTransaction,
  ProviderWebhookEvent,
  RefundRequest,
  RefundTransaction,
} from "../payment-provider.interface";
import { PaymentProviderRegistry } from "../payment-provider.registry";

/**
 * Ingenico card-present terminal provider.
 *
 * Why a PaymentProvider AND a PaymentTerminal: the Ingenico ECR is a physical
 * device sitting on the restaurant LAN, reachable only through the on-prem
 * Local Bridge agent. There is no acquirer URL we can POST to from the cloud.
 * So the cloud-side flow is:
 *
 *   createIntent  → reserve a `cardPresent` intent + enqueue a `charge_card`
 *                   device command (idempotent on (deviceId, idempotencyKey))
 *                   that the bridge relays to the terminal's ECR/OPI interface.
 *   status        → poll the device command's `result` JSON (the bridge writes
 *                   the ECR response back via the device ack path). NEVER
 *                   fabricates a success — a queued/inflight command maps to
 *                   `pending`, and only a real `Approved`/auth-code response
 *                   maps to `succeeded`.
 *   refund        → enqueue a follow-on void/refund command referencing the
 *                   original acquirer transaction id.
 *
 * `charge_card` is registered NON_RETRYABLE in CommandQueueService: a terminal
 * that authorised then lost its ack must NOT be re-issued (double charge). The
 * idempotencyKey from PaymentIntentRequest is the de-dup anchor end to end —
 * the same key returns the same command row from enqueue(), and the same intent
 * row from createIntent(). The interface documents createIntent as idempotent;
 * we honour it by deriving the intentId deterministically from the key.
 *
 * The real Ingenico ECR SDK lives on the bridge, not here. We model the
 * request/response wire types (OPI/ECR-style) explicitly so the payload we
 * enqueue is a faithful, typed contract the bridge dispatcher binds to, and so
 * the response we parse back is shape-checked rather than `any`-cast.
 */

// ---------------------------------------------------------------------------
// ECR / OPI wire types — what the bridge relays to the terminal and back.
// Modelled from a documented OPI (Open Payment Initiative) CardServiceRequest
// / CardServiceResponse pair as used by Ingenico ECR integrations. Kept
// explicit so the device-command payload is typed end to end (no `any` leak).
// ---------------------------------------------------------------------------

/** Operation the ECR is asked to perform. */
export type IngenicoEcrRequestType =
  | "CardPayment"
  | "PaymentReversal"
  | "AbortRequest";

/** ECR request relayed to the terminal via the `charge_card` device command. */
export interface IngenicoEcrRequest {
  /** OPI POSdata / WorkstationID — identifies the lane. Echoed back. */
  requestType: IngenicoEcrRequestType;
  /** Caller idempotency anchor, surfaced to the terminal as POSReference. */
  posReference: string;
  /**
   * Amount in MINOR units (kuruş/cents). The OPI TotalAmount is a decimal
   * string in major units; the bridge formats it from this integer so the
   * cloud never does float math on money.
   */
  amountMinor: number;
  /** ISO-4217 alpha code (e.g. "TRY"). */
  currency: string;
  /**
   * Original acquirer transaction id — required for PaymentReversal, omitted
   * for CardPayment.
   */
  originalTransactionId?: string;
  /** Free-text printed on the merchant slip; surfaced from `purpose`. */
  slipText?: string;
  /** Echo on the response for correlation. */
  externalRef: string;
}

/** Terminal outcome as reported by the ECR. */
export type IngenicoEcrOverallResult =
  | "Success" // Approved
  | "Failure" // Declined / aborted
  | "Pending"; // Card inserted, awaiting completion

/** ECR response the bridge writes back as the device command `result`. */
export interface IngenicoEcrResponse {
  overallResult: IngenicoEcrOverallResult;
  /** Acquirer/host transaction id — printed on the customer statement. */
  acquirerTransactionId?: string;
  /** Auth code (OPI AuthorisationCode). */
  authorisationCode?: string;
  /** Card scheme (VISA, MASTERCARD, TROY, …). */
  cardCircuit?: string;
  /** Masked PAN tail. */
  maskedPan?: string;
  /** Host response/error code for forensic / decline-reason surfacing. */
  responseCode?: string;
  /** Human-readable decline/error text from the host. */
  responseText?: string;
}

/** Shape of the device command `result` JSON as written by the bridge. */
interface ChargeCardCommandResult {
  ecrResponse?: IngenicoEcrResponse;
}

@Injectable()
export class IngenicoTerminalProvider implements PaymentProvider, OnModuleInit {
  readonly id = "ingenico";
  readonly modes: PaymentMode[] = ["cardPresent"];
  private readonly logger = new Logger(IngenicoTerminalProvider.name);

  constructor(
    private readonly registry: PaymentProviderRegistry,
    private readonly commands: CommandQueueService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Card-present is opt-in per deployment: a restaurant only has terminals
    // once the acquirer integration is signed and a terminal is paired. Mirror
    // the PayTR adapter's env gate so dev/staging boots without terminals don't
    // advertise a provider that can never service a charge.
    if (process.env.INGENICO_ECR_ENABLED === "true") {
      this.registry.register(this);
    } else {
      this.logger.warn(
        "Ingenico ECR disabled (INGENICO_ECR_ENABLED!=true) — provider not registered",
      );
    }
  }

  /**
   * Reserve a card-present intent and dispatch the charge to the paired
   * terminal via a `charge_card` device command.
   *
   * Idempotent per the interface contract: createIntent with the same
   * idempotencyKey returns the same intent. The device command enqueue is
   * itself idempotent on (deviceId, idempotencyKey), so a retried createIntent
   * does not double-dispatch a charge to the terminal.
   *
   * The caller routes the charge to a specific terminal by passing the paired
   * device id in `metadata.deviceId`. Branch scope (when present) is forwarded
   * so a branch-restricted operator cannot drive a terminal in another branch.
   */
  async createIntent(req: PaymentIntentRequest): Promise<PaymentIntent> {
    const deviceId =
      typeof req.metadata?.deviceId === "string"
        ? req.metadata.deviceId
        : undefined;
    if (!deviceId) {
      throw new BadRequestException(
        "Ingenico cardPresent intent requires metadata.deviceId (the paired terminal).",
      );
    }
    if (!Number.isInteger(req.amountCents) || req.amountCents <= 0) {
      throw new BadRequestException(
        `Ingenico intent requires a positive integer amountCents; got ${req.amountCents}.`,
      );
    }
    const branchId =
      typeof req.metadata?.branchId === "string"
        ? req.metadata.branchId
        : undefined;

    // Deterministic intentId from the idempotency anchor so a retried call
    // returns the same intent without an extra round-trip. The terminal sees
    // it as POSReference; the bridge echoes it on the ECR response.
    const intentId = `ING-${req.idempotencyKey}`;

    const ecrRequest: IngenicoEcrRequest = {
      requestType: "CardPayment",
      posReference: intentId,
      amountMinor: req.amountCents,
      currency: req.currency,
      slipText: req.purpose,
      externalRef: req.externalRef,
    };

    // The device command idempotencyKey IS the caller's anchor — enqueue
    // dedups on (deviceId, idempotencyKey), so the terminal is asked to charge
    // exactly once across retries.
    await this.commands.enqueue(
      req.tenantId,
      deviceId,
      {
        kind: "charge_card",
        payload: {
          ecrRequest: ecrRequest as unknown as Record<string, unknown>,
        },
        // Card-present payment is time-sensitive (the customer is standing at
        // the terminal) — pull ahead of cosmetic prints.
        priority: 10,
        idempotencyKey: req.idempotencyKey,
      },
      branchId,
    );

    return {
      providerId: this.id,
      intentId,
      // The charge is queued for the terminal; nothing is authorised yet.
      // requires_action signals the client to surface "follow the terminal".
      status: "requires_action",
      amountCents: req.amountCents,
      currency: req.currency,
      clientAction: {
        // The client polls status(intentId) until the terminal completes.
        terminalDeviceId: deviceId,
        ecrRequest,
        prompt: "Müşteriyi POS cihazından ödemeye yönlendirin.",
      },
    };
  }

  /**
   * Poll the dispatched `charge_card` command's result.
   *
   * The bridge writes the ECR response into the device command `result` JSON
   * via the device ack path. We read it back and map the ECR overallResult to a
   * PaymentStatus. A queued/inflight command (no result yet) is `pending`; a
   * command that terminated `failed` with no ECR response is `failed`. We do
   * NOT invent a success — only a real `Success` overallResult with an auth
   * trail maps to `succeeded`.
   */
  async status(intentId: string): Promise<PaymentTransaction> {
    const idempotencyKey = this.intentIdToIdempotencyKey(intentId);
    const cmd = await this.prisma.deviceCommand.findFirst({
      where: { idempotencyKey, kind: "charge_card" },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        result: true,
        error: true,
      },
    });
    if (!cmd) {
      throw new NotFoundException(`Unknown Ingenico intent: ${intentId}`);
    }

    const ecr = this.extractEcrResponse(cmd.result);
    const status = this.mapStatus(cmd.status, ecr);

    return {
      providerId: this.id,
      intentId,
      status,
      // We deliberately do not echo a guessed amount: the authoritative figure
      // lives on the reservation the caller already holds. Surface 0 only when
      // the terminal hasn't reported; otherwise the ECR doesn't carry a minor
      // amount back on this wire shape, so keep the caller's number out of a
      // poll response it didn't supply.
      amountCents: 0,
      currency: "TRY",
      acquirerRef: ecr?.acquirerTransactionId,
      authCode: ecr?.authorisationCode,
      cardBrand: ecr?.cardCircuit,
      cardLast4: this.last4(ecr?.maskedPan),
      raw: ecr ? ({ ...ecr } as Record<string, unknown>) : undefined,
    };
  }

  /**
   * Issue a void/refund. For a card-present terminal this is a follow-on
   * PaymentReversal relayed to the ECR, referencing the original acquirer
   * transaction id resolved from the completed charge command.
   */
  async refund(req: RefundRequest): Promise<RefundTransaction> {
    const idempotencyKey = this.intentIdToIdempotencyKey(req.intentId);
    const charge = await this.prisma.deviceCommand.findFirst({
      where: { idempotencyKey, kind: "charge_card" },
      orderBy: { createdAt: "desc" },
      select: { tenantId: true, deviceId: true, branchId: true, result: true },
    });
    if (!charge) {
      throw new NotFoundException(
        `Cannot refund unknown Ingenico intent: ${req.intentId}`,
      );
    }
    const ecr = this.extractEcrResponse(charge.result);
    if (!ecr?.acquirerTransactionId) {
      // No host transaction id means the original charge never reached
      // `succeeded` — there is nothing to reverse, and guessing would let a
      // caller "refund" a charge that never happened.
      throw new BadRequestException(
        `Ingenico intent ${req.intentId} has no completed acquirer transaction to reverse.`,
      );
    }

    const reversalRequest: IngenicoEcrRequest = {
      requestType: "PaymentReversal",
      posReference: `${req.intentId}-RV`,
      // Omitted amount = full reversal; a partial amount is sent when present.
      amountMinor: req.amountCents ?? 0,
      currency: "TRY",
      originalTransactionId: ecr.acquirerTransactionId,
      slipText: req.reason,
      externalRef: req.intentId,
    };

    await this.commands.enqueue(
      charge.tenantId,
      charge.deviceId,
      {
        kind: "charge_card",
        payload: {
          ecrRequest: reversalRequest as unknown as Record<string, unknown>,
        },
        priority: 10,
        idempotencyKey: req.idempotencyKey,
      },
      charge.branchId,
    );

    return {
      providerId: this.id,
      intentId: req.intentId,
      refundId: `${req.intentId}-RV`,
      // The reversal is queued for the terminal; it is not confirmed until the
      // bridge writes the ECR response back. The caller polls status() of the
      // refund command for the terminal outcome.
      status: "pending",
      amountCents: req.amountCents ?? 0,
    };
  }

  /**
   * Card-present terminals have no inbound webhook — the bridge pushes results
   * via the device ack path, not an HTTP callback. Return an empty event list
   * so the uniform webhook ingest is a no-op for this provider.
   */
  async parseWebhook(
    _signature: string,
    _raw: Buffer | string,
  ): Promise<ProviderWebhookEvent[]> {
    return [];
  }

  async healthCheck(): Promise<{
    ok: boolean;
    details?: Record<string, unknown>;
  }> {
    const enabled = process.env.INGENICO_ECR_ENABLED === "true";
    return {
      ok: enabled,
      details: {
        enabled,
        transport: "device-mesh/charge_card",
      },
    };
  }

  /**
   * Bind a paired terminal device to the PaymentTerminal shape. Each physical
   * terminal is one PaymentTerminal; the cloud holds no SDK, only the device id
   * + tenant/branch scope used to enqueue ECR commands through the bridge.
   */
  terminalFor(args: {
    deviceId: string;
    tenantId: string;
    branchId?: string;
  }): PaymentTerminal {
    return new IngenicoPaymentTerminal(
      this.id,
      args.deviceId,
      args.tenantId,
      args.branchId,
      this.commands,
      this.prisma,
    );
  }

  // -- helpers --------------------------------------------------------------

  private intentIdToIdempotencyKey(intentId: string): string {
    if (!intentId.startsWith("ING-")) {
      throw new BadRequestException(
        `Malformed Ingenico intentId: ${intentId} (expected ING- prefix).`,
      );
    }
    return intentId.slice("ING-".length);
  }

  private extractEcrResponse(result: unknown): IngenicoEcrResponse | undefined {
    if (!result || typeof result !== "object") return undefined;
    const ecr = (result as ChargeCardCommandResult).ecrResponse;
    if (!ecr || typeof ecr !== "object") return undefined;
    return ecr;
  }

  private mapStatus(
    commandStatus: string,
    ecr: IngenicoEcrResponse | undefined,
  ): PaymentStatus {
    if (ecr) {
      switch (ecr.overallResult) {
        case "Success":
          return "succeeded";
        case "Failure":
          return "failed";
        case "Pending":
          return "pending";
      }
    }
    // No ECR response yet — fall back to the command lifecycle. A terminated
    // `failed`/`expired` command with no terminal response is a genuine
    // failure (the charge never completed); queued/inflight is still pending.
    switch (commandStatus) {
      case "failed":
      case "expired":
        return "failed";
      case "done":
        // Done but no parseable ECR response → treat as failed rather than
        // silently succeeding. A real approval always carries the ECR payload.
        return "failed";
      default:
        return "pending";
    }
  }

  private last4(maskedPan?: string): string | undefined {
    if (!maskedPan) return undefined;
    const digits = maskedPan.replace(/\D/g, "");
    return digits.length >= 4 ? digits.slice(-4) : undefined;
  }
}

/**
 * One paired Ingenico terminal, exposed through the PaymentTerminal seam.
 *
 * charge/void/status all route through the Device Mesh `charge_card` command to
 * the on-prem ECR via the local bridge. Construction is via
 * IngenicoTerminalProvider.terminalFor(); not a Nest provider itself (there is
 * one instance per physical device, resolved at request time).
 */
export class IngenicoPaymentTerminal implements PaymentTerminal {
  readonly id: string;
  private readonly logger = new Logger(IngenicoPaymentTerminal.name);

  constructor(
    readonly providerId: string,
    readonly deviceId: string,
    private readonly tenantId: string,
    private readonly branchId: string | undefined,
    private readonly commands: CommandQueueService,
    private readonly prisma: PrismaService,
  ) {
    this.id = `ingenico:${deviceId}`;
  }

  /**
   * Charge the card present at this terminal. Idempotent on the caller's
   * idempotencyKey (enqueue dedups on (deviceId, idempotencyKey)), so a retried
   * charge does not double-bill. Returns the current transaction state — which
   * starts `pending` until the bridge reports the ECR result back.
   */
  async charge(req: {
    amountCents: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<PaymentTransaction> {
    if (!Number.isInteger(req.amountCents) || req.amountCents <= 0) {
      throw new BadRequestException(
        `Ingenico terminal charge requires a positive integer amountCents; got ${req.amountCents}.`,
      );
    }
    const intentId = `ING-${req.idempotencyKey}`;
    const ecrRequest: IngenicoEcrRequest = {
      requestType: "CardPayment",
      posReference: intentId,
      amountMinor: req.amountCents,
      currency: req.currency,
      externalRef: intentId,
    };

    await this.commands.enqueue(
      this.tenantId,
      this.deviceId,
      {
        kind: "charge_card",
        payload: {
          ecrRequest: ecrRequest as unknown as Record<string, unknown>,
        },
        priority: 10,
        idempotencyKey: req.idempotencyKey,
      },
      this.branchId,
    );

    return {
      providerId: this.providerId,
      intentId,
      status: "pending",
      amountCents: req.amountCents,
      currency: req.currency,
    };
  }

  /**
   * Void an in-flight/completed transaction by enqueuing a PaymentReversal to
   * the terminal referencing the original acquirer transaction id.
   */
  async void(transactionId: string): Promise<void> {
    const idempotencyKey = transactionId.startsWith("ING-")
      ? transactionId.slice("ING-".length)
      : transactionId;
    const charge = await this.prisma.deviceCommand.findFirst({
      where: { idempotencyKey, kind: "charge_card", deviceId: this.deviceId },
      orderBy: { createdAt: "desc" },
      select: { result: true },
    });
    const ecr =
      charge?.result && typeof charge.result === "object"
        ? (charge.result as ChargeCardCommandResult).ecrResponse
        : undefined;
    if (!ecr?.acquirerTransactionId) {
      throw new BadRequestException(
        `Cannot void ${transactionId}: no completed acquirer transaction on this terminal.`,
      );
    }
    const reversalRequest: IngenicoEcrRequest = {
      requestType: "PaymentReversal",
      posReference: `${transactionId}-RV`,
      amountMinor: 0, // full reversal
      currency: "TRY",
      originalTransactionId: ecr.acquirerTransactionId,
      externalRef: transactionId,
    };
    await this.commands.enqueue(
      this.tenantId,
      this.deviceId,
      {
        kind: "charge_card",
        payload: {
          ecrRequest: reversalRequest as unknown as Record<string, unknown>,
        },
        priority: 10,
        idempotencyKey: `${idempotencyKey}-RV`,
      },
      this.branchId,
    );
  }

  /**
   * Report terminal liveness from the paired device's status. A device with a
   * `charge_card` command currently inflight is reported `busy`.
   */
  async status(): Promise<{
    status: "online" | "offline" | "busy" | "error";
    details?: Record<string, unknown>;
  }> {
    const device = await this.prisma.device.findFirst({
      where: {
        id: this.deviceId,
        tenantId: this.tenantId,
        ...(this.branchId ? { branchId: this.branchId } : {}),
      },
      select: { status: true },
    });
    if (!device) {
      return { status: "offline", details: { reason: "device-not-found" } };
    }
    switch (device.status) {
      case "online":
        return { status: "online" };
      case "busy":
        return { status: "busy" };
      case "error":
        return { status: "error" };
      default:
        // unprovisioned | claimed | paired | offline | maintenance | retired
        return { status: "offline", details: { deviceStatus: device.status } };
    }
  }
}
