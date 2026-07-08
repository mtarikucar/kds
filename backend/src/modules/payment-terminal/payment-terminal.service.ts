import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { BranchScope, branchScope } from "../../common/scoping/branch-scope";
import { OrderStatus } from "../../common/constants/order-status.enum";
import { CommandQueueService } from "../device-mesh/command-queue.service";
import { PaymentsService } from "../orders/services/payments.service";
import { PaymentTerminalProviderRegistry } from "./payment-terminal-provider.registry";
import {
  PaymentTerminalProvider,
  TerminalChargeRequest,
  TerminalChargeResult,
  TerminalFiscalContext,
} from "./payment-terminal-provider.interface";
import { buildFiscalLines } from "../orders/services/fiscal-line-builder";

const ACTIVE_STATES = ["ACTIVE", "SIMULATOR"];
const FISCAL_COUPLED = "fiscal_coupled";

@Injectable()
export class PaymentTerminalService {
  private readonly logger = new Logger(PaymentTerminalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commandQueue: CommandQueueService,
    private readonly registry: PaymentTerminalProviderRegistry,
    private readonly paymentsService: PaymentsService,
  ) {}

  /** The active terminal for the branch (or null → caller falls back to manual card). */
  async resolveTerminal(scope: BranchScope) {
    return this.prisma.paymentTerminalRecord.findFirst({
      where: {
        tenantId: scope.tenantId,
        OR: [{ branchId: scope.branchId }, { branchId: null }],
        status: { not: "retired" },
        activationState: { in: ACTIVE_STATES },
      },
      orderBy: { branchId: "desc" }, // prefer a branch-specific terminal over a tenant-wide one
    });
  }

  // ── Provisioning ────────────────────────────────────────────────────────

  private static readonly TERMINAL_DEVICE_KINDS = [
    "pos_terminal",
    "yazarkasa",
    "local_bridge",
  ];

  /** Registered providers, so the provisioning UI can populate the form. */
  listProviders() {
    return this.registry.list().map((p) => ({
      id: p.id,
      kind: p.kind,
      capabilities: p.capabilities,
      fiscalCoupled: p.capabilities.includes("fiscal_coupled"),
    }));
  }

  /** Terminals registered for this branch (and tenant-wide), excluding retired. */
  async listTerminals(scope: BranchScope) {
    const rows = await this.prisma.paymentTerminalRecord.findMany({
      where: {
        tenantId: scope.tenantId,
        OR: [{ branchId: scope.branchId }, { branchId: null }],
        status: { not: "retired" },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) =>
      this.toTerminalView(
        r,
        this.registry.has(r.providerId)
          ? this.registry.get(r.providerId)
          : null,
      ),
    );
  }

  /**
   * Register a terminal record. Real adapters start INERT
   * (CONFIGURED_NOT_ACTIVE) — fail-closed, so they can never charge until an
   * operator explicitly activates them on certified hardware. Bridge providers
   * require a paired device to route charge_card commands.
   */
  async registerTerminal(
    scope: BranchScope,
    dto: {
      providerId: string;
      serial: string;
      model?: string;
      deviceId?: string;
      config?: Record<string, unknown>;
    },
  ) {
    if (!this.registry.has(dto.providerId)) {
      throw new BadRequestException(
        `Unknown payment-terminal provider: ${dto.providerId}`,
      );
    }
    const provider = this.registry.get(dto.providerId);

    if (dto.deviceId) {
      const device = await this.prisma.device.findFirst({
        where: { id: dto.deviceId, tenantId: scope.tenantId },
        select: { id: true, kind: true },
      });
      if (!device) {
        throw new BadRequestException("Linked device not found in this tenant");
      }
      if (!PaymentTerminalService.TERMINAL_DEVICE_KINDS.includes(device.kind)) {
        throw new BadRequestException(
          `Device kind "${device.kind}" cannot drive a card terminal`,
        );
      }
    } else if (provider.kind === "bridge") {
      throw new BadRequestException(
        "This provider routes charges through a device — pair one and pass deviceId",
      );
    }

    try {
      const rec = await this.prisma.paymentTerminalRecord.create({
        data: {
          tenantId: scope.tenantId,
          branchId: scope.branchId ?? null,
          providerId: dto.providerId,
          deviceId: dto.deviceId ?? null,
          serial: dto.serial,
          model: dto.model ?? null,
          capabilities: provider.capabilities,
          status: "offline",
          activationState: "CONFIGURED_NOT_ACTIVE",
          config: (dto.config ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
      return this.toTerminalView(rec, provider);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException(
          "A terminal with this provider and serial already exists",
        );
      }
      throw err;
    }
  }

  /**
   * Flip a terminal's activation state. ACTIVE (real money) is gated: the
   * provider must be registered, the simulator can never be ACTIVE (use
   * SIMULATOR), and a bridge provider must have a paired device. SIMULATOR is
   * only valid for the simulator provider. This is the fail-closed boundary
   * between "configured" and "charges real cards".
   */
  async setActivation(scope: BranchScope, id: string, state: string) {
    const rec = await this.prisma.paymentTerminalRecord.findFirst({
      where: {
        id,
        tenantId: scope.tenantId,
        OR: [{ branchId: scope.branchId }, { branchId: null }],
      },
    });
    if (!rec) throw new NotFoundException("Terminal not found");
    const provider = this.registry.has(rec.providerId)
      ? this.registry.get(rec.providerId)
      : null;

    if (state === "SIMULATOR" && rec.providerId !== "simulator") {
      throw new BadRequestException(
        "SIMULATOR is only valid for the simulator provider",
      );
    }
    if (state === "ACTIVE") {
      if (!provider) {
        throw new BadRequestException(
          `Provider ${rec.providerId} is not registered — cannot activate`,
        );
      }
      if (rec.providerId === "simulator") {
        throw new BadRequestException(
          "The simulator can never be ACTIVE — use SIMULATOR",
        );
      }
      if (provider.activatable === false) {
        throw new BadRequestException(
          `Provider ${rec.providerId} is not available yet (its integration is not wired)`,
        );
      }
      if (provider.kind === "bridge" && !rec.deviceId) {
        throw new BadRequestException(
          "Pair a device before activating this terminal",
        );
      }
    }

    const updated = await this.prisma.paymentTerminalRecord.update({
      where: { id: rec.id },
      data: { activationState: state },
    });
    return this.toTerminalView(updated, provider);
  }

  /** Soft-retire a terminal: it stops resolving and drops out of the list. */
  async removeTerminal(scope: BranchScope, id: string) {
    const rec = await this.prisma.paymentTerminalRecord.findFirst({
      where: {
        id,
        tenantId: scope.tenantId,
        OR: [{ branchId: scope.branchId }, { branchId: null }],
      },
      select: { id: true },
    });
    if (!rec) throw new NotFoundException("Terminal not found");
    await this.prisma.paymentTerminalRecord.update({
      where: { id: rec.id },
      data: { status: "retired", activationState: "DISABLED" },
    });
    return { id: rec.id, retired: true };
  }

  private toTerminalView(
    rec: {
      id: string;
      providerId: string;
      capabilities: string[];
      serial: string;
      model: string | null;
      branchId: string | null;
      deviceId: string | null;
      status: string;
      activationState: string;
      lastSeenAt: Date | null;
    },
    provider: PaymentTerminalProvider | null,
  ) {
    const capabilities = rec.capabilities?.length
      ? rec.capabilities
      : (provider?.capabilities ?? []);
    return {
      id: rec.id,
      providerId: rec.providerId,
      providerKind: provider?.kind ?? null,
      providerRegistered: !!provider,
      capabilities,
      fiscalCoupled: capabilities.includes("fiscal_coupled"),
      serial: rec.serial,
      model: rec.model ?? null,
      branchId: rec.branchId ?? null,
      deviceId: rec.deviceId ?? null,
      status: rec.status,
      activationState: rec.activationState,
      lastSeenAt: rec.lastSeenAt ?? null,
      // config DELIBERATELY omitted from the view — it may carry vendor creds.
    };
  }

  /**
   * Start a card charge on the terminal. Records NOTHING yet — only an
   * APPROVED result writes a Payment (see applyResult). For bridge providers
   * this enqueues a non-retryable charge_card command and returns PENDING; the
   * caller polls getCharge(). For in-process providers (simulator/SoftPOS) the
   * charge resolves here.
   */
  async charge(
    scope: BranchScope,
    orderId: string,
    dto: { amount: number; idempotencyKey?: string },
    initiatedByUserId: string | null = null,
  ) {
    const terminal = await this.resolveTerminal(scope);
    if (!terminal) {
      throw new BadRequestException(
        "No active payment terminal configured for this branch",
      );
    }
    const provider = this.registry.get(terminal.providerId);

    // Sanity-gate the order + amount before charging. The authoritative
    // remaining check happens at record time (PaymentsService.create), but we
    // refuse to charge a card for a clearly-invalid order/amount.
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...branchScope(scope) },
      select: { id: true, status: true, finalAmount: true },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (
      order.status === OrderStatus.PAID ||
      order.status === OrderStatus.CANCELLED
    ) {
      throw new ConflictException("Order is not payable");
    }
    if (!(dto.amount > 0)) {
      throw new BadRequestException("Amount must be positive");
    }
    const amountCents = Math.round(dto.amount * 100);

    // fiscal_coupled providers (GMP-3) print the mali fiş in the same op — send
    // the SAME lines/KDV the standalone yazarkasa rail would build.
    const fiscalContext = provider.capabilities.includes("fiscal_coupled")
      ? await this.buildFiscalContext(scope, orderId)
      : null;

    const idempotencyKey = dto.idempotencyKey ?? randomUUID();

    // Idempotent START: a double-click with the same key returns the existing
    // charge rather than opening a second one (no double-charge on retry).
    const existing = await this.prisma.paymentTerminalCharge.findFirst({
      where: { tenantId: scope.tenantId, idempotencyKey },
    });
    if (existing) {
      return this.toView(existing);
    }

    const charge = await this.prisma.paymentTerminalCharge.create({
      data: {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        orderId,
        terminalRecordId: terminal.id,
        providerId: terminal.providerId,
        amountCents,
        status: "PENDING",
        idempotencyKey,
      },
    });

    const req: TerminalChargeRequest = {
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      orderId,
      amountCents,
      terminal: {
        id: terminal.id,
        providerId: terminal.providerId,
        deviceId: terminal.deviceId,
        serial: terminal.serial,
        config: (terminal.config as Record<string, unknown> | null) ?? null,
      },
      idempotencyKey,
      fiscalContext,
    };

    if (provider.kind === "bridge") {
      if (!terminal.deviceId || !provider.buildSaleCommand) {
        await this.markCharge(charge.id, scope.tenantId, {
          status: "ERROR",
          error: "Terminal has no paired device",
        });
        throw new BadRequestException("Terminal has no paired device");
      }
      const cmd = provider.buildSaleCommand(req);
      const enqueued = await this.commandQueue.enqueue(
        scope.tenantId,
        terminal.deviceId,
        {
          kind: cmd.kind,
          payload: cmd.payload,
          priority: cmd.priority ?? 10,
          idempotencyKey: cmd.idempotencyKey,
        },
        scope.branchId,
      );
      await this.prisma.paymentTerminalCharge.update({
        where: { id: charge.id },
        data: { deviceCommandId: enqueued.id },
      });
      return this.toView(charge);
    }

    // in_process (simulator / SoftPOS): resolve now.
    const result = await provider.charge!(req);
    const updated = await this.applyResult(
      charge.id,
      scope.tenantId,
      provider,
      result,
      initiatedByUserId,
    );
    return updated;
  }

  /**
   * Build the fiş context for a fiscal_coupled (GMP-3) sale: the device prints
   * the mali fiş in the same op, so we send the SAME lines/KDV the standalone
   * yazarkasa rail builds, with a single CARD tender. fiscal_coupled is for
   * full-order settlement (one fiş per order) — the tender is the goods net so
   * the fiş balances on the device. Returns null for an itemless order.
   */
  private async buildFiscalContext(
    scope: BranchScope,
    orderId: string,
  ): Promise<TerminalFiscalContext | null> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...branchScope(scope) },
      include: { orderItems: { include: { product: true } } },
    });
    if (!order || order.orderItems.length === 0) return null;
    // Exclude combo parents (0₺ grouping rows) — money + KDV are on children.
    const comboParentIds = new Set(
      order.orderItems
        .filter((it) => it.parentOrderItemId)
        .map((it) => it.parentOrderItemId),
    );
    const { lines, netCents } = buildFiscalLines(
      order.orderItems
        .filter((it) => !comboParentIds.has(it.id))
        .map((it) => ({
          productId: it.productId,
          productName: it.product?.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          modifierTotal: it.modifierTotal,
          taxRate: it.taxRate,
        })),
      order.discount,
    );
    return {
      kind: "cash_receipt",
      lines,
      payments: [{ method: "card", amountCents: netCents }],
      customer: null,
    };
  }

  /** Poll a charge. For bridge charges, reads the device-command ack and, once
   *  it lands, maps + applies it (records the Payment on APPROVED). */
  async getCharge(
    scope: BranchScope,
    chargeId: string,
    initiatedByUserId: string | null = null,
  ) {
    const charge = await this.prisma.paymentTerminalCharge.findFirst({
      where: { id: chargeId, ...branchScope(scope) },
    });
    if (!charge) throw new NotFoundException("Charge not found");

    if (charge.status !== "PENDING" || !charge.deviceCommandId) {
      return this.toView(charge);
    }

    const cmd = await this.prisma.deviceCommand.findFirst({
      where: { id: charge.deviceCommandId, tenantId: scope.tenantId },
      select: { status: true, result: true, error: true },
    });
    if (!cmd) return this.toView(charge);

    if (
      cmd.status === "done" ||
      cmd.status === "failed" ||
      cmd.status === "expired"
    ) {
      const provider = this.registry.get(charge.providerId);
      const result: TerminalChargeResult = provider.mapAck
        ? provider.mapAck({
            status: cmd.status,
            result: (cmd.result as Record<string, unknown> | null) ?? null,
            error: cmd.error ?? null,
          })
        : {
            status: cmd.status === "done" ? "APPROVED" : "ERROR",
            error: cmd.error ?? undefined,
          };
      return this.applyResult(
        charge.id,
        scope.tenantId,
        provider,
        result,
        initiatedByUserId,
      );
    }
    return this.toView(charge); // still queued/inflight
  }

  /** Operator aborts a still-PENDING charge. The non-retryable device command
   *  may still land; if it APPROVED, the recovery sweep records it. */
  async cancel(scope: BranchScope, chargeId: string) {
    const charge = await this.prisma.paymentTerminalCharge.findFirst({
      where: { id: chargeId, ...branchScope(scope) },
    });
    if (!charge) throw new NotFoundException("Charge not found");
    if (charge.status !== "PENDING") return this.toView(charge);
    // Guarded: only cancel if STILL pending. A concurrent poll/recovery may
    // have recorded the Payment between the read and here — an unconditional
    // update would clobber RECORDED→CANCELLED with a Payment on the books.
    await this.prisma.paymentTerminalCharge.updateMany({
      where: { id: charge.id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    const after = await this.prisma.paymentTerminalCharge.findFirst({
      where: { id: charge.id, tenantId: scope.tenantId },
    });
    return this.toView(after ?? charge);
  }

  /**
   * Void a charge BEFORE it became a recorded Payment (pre-settlement reversal):
   *  - PENDING                       → same as cancel.
   *  - APPROVED/NEEDS_REVIEW (no     → mark VOIDED; for a bridge terminal, send
   *    Payment recorded yet)            a void_card to reverse the auth on-device.
   *  - RECORDED (Payment exists)     → REFUSE — a settled card payment must be
   *                                     reversed through the order refund flow
   *                                     (single money-reversal rail), never by
   *                                     a second terminal op that would desync
   *                                     the recorded Payment.
   *  - terminal states               → no-op (return current view).
   */
  async voidCharge(scope: BranchScope, chargeId: string) {
    const charge = await this.prisma.paymentTerminalCharge.findFirst({
      where: { id: chargeId, ...branchScope(scope) },
    });
    if (!charge) throw new NotFoundException("Charge not found");

    if (charge.status === "PENDING") return this.cancel(scope, chargeId);

    if (charge.status === "RECORDED" || charge.paymentId) {
      throw new ConflictException(
        "This charge is already recorded as a payment — reverse it through the order refund flow",
      );
    }

    if (charge.status !== "APPROVED" && charge.status !== "NEEDS_REVIEW") {
      // DECLINED / TIMEOUT / ERROR / CANCELLED / VOIDED — nothing to void.
      return this.toView(charge);
    }

    // APPROVED/NEEDS_REVIEW with no Payment: reverse the auth. Guarded flip
    // FIRST — only void while still un-recorded (no Payment). This wins the
    // race against a concurrent poll / 5-min recovery cron that may record the
    // Payment between the read above and here; without the guard an
    // unconditional update would mark a RECORDED charge VOIDED, leaving money
    // on the books but invisible to reconciliation.
    const flip = await this.prisma.paymentTerminalCharge.updateMany({
      where: {
        id: charge.id,
        status: { in: ["APPROVED", "NEEDS_REVIEW"] },
        paymentId: null,
      },
      data: { status: "VOIDED" },
    });
    const after = await this.prisma.paymentTerminalCharge.findFirst({
      where: { id: charge.id, tenantId: scope.tenantId },
    });
    if (flip.count === 0) {
      // Lost the race (or state changed concurrently). If it recorded, the
      // operator must use the order refund flow, not a terminal void.
      if (after && (after.status === "RECORDED" || after.paymentId)) {
        throw new ConflictException(
          "This charge was just recorded as a payment — reverse it through the order refund flow",
        );
      }
      return this.toView(after ?? charge);
    }

    // We won the flip → now reverse the auth on a bridge terminal. (Real
    // reversal is hardware-side, P4; the simulator/in-process just stays VOIDED.)
    const provider = this.registry.has(charge.providerId)
      ? this.registry.get(charge.providerId)
      : null;
    if (provider?.kind === "bridge") {
      const terminal = await this.prisma.paymentTerminalRecord.findFirst({
        where: { id: charge.terminalRecordId, tenantId: scope.tenantId },
        select: { deviceId: true },
      });
      if (terminal?.deviceId) {
        await this.commandQueue
          .enqueue(
            scope.tenantId,
            terminal.deviceId,
            {
              kind: "void_card",
              payload: {
                chargeId: charge.id,
                orderId: charge.orderId,
                approvalCode: charge.approvalCode ?? null,
                rrn: charge.rrn ?? null,
                originalCommandId: charge.deviceCommandId ?? null,
              },
              priority: 10,
              idempotencyKey: `void:${charge.idempotencyKey}`,
            },
            scope.branchId ?? undefined,
          )
          .catch((err) =>
            this.logger.error(
              `void_card enqueue failed for charge ${charge.id}: ${err?.message}`,
            ),
          );
      }
    }

    return this.toView(after ?? charge);
  }

  /**
   * Apply a terminal result to the charge. On APPROVED, record the Payment via
   * the money-safe PaymentsService.create (order lock + finalize + fiş), set
   * paymentId, flip to RECORDED. DECLINED/TIMEOUT/ERROR just store the outcome
   * — no Payment, order stays open. Idempotent: an already-RECORDED charge is
   * a no-op (so polling + the recovery sweep can't double-book).
   */
  private async applyResult(
    chargeId: string,
    tenantId: string,
    provider: PaymentTerminalProvider,
    result: TerminalChargeResult,
    initiatedByUserId: string | null,
  ) {
    const charge = await this.prisma.paymentTerminalCharge.findFirst({
      where: { id: chargeId, tenantId },
    });
    if (!charge) throw new NotFoundException("Charge not found");
    if (charge.status === "RECORDED" || charge.paymentId) {
      return this.toView(charge);
    }
    if (charge.status === "VOIDED") {
      // An operator voided this APPROVED charge (auth reversed on-device) while
      // the terminal result / recovery sweep was in flight. It must NEVER be
      // recorded as a Payment — doing so would resurrect a voided charge and
      // put money back on the books that was explicitly reversed. Return the
      // current (VOIDED) view without recording. (CANCELLED, by contrast, is
      // the PENDING-cancel path and may still legitimately record if the card
      // actually approved — see the guarded final update below.)
      return this.toView(charge);
    }

    if (result.status !== "APPROVED") {
      const updated = await this.prisma.paymentTerminalCharge.update({
        where: { id: charge.id },
        data: {
          status: result.status,
          error: result.error ?? null,
          approvalCode: result.approvalCode ?? null,
          cardBrand: result.cardBrand ?? null,
        },
      });
      return this.toView(updated);
    }

    // APPROVED — record the Payment through the canonical money-safe path.
    // Reuse the charge's idempotencyKey so a re-record (poll race / recovery
    // sweep) is deduped by PaymentsService.create's (tenantId, idempotencyKey).
    let paymentId: string | null = null;
    try {
      const payment = await this.paymentsService.create(
        charge.orderId,
        {
          amount: charge.amountCents / 100,
          method: "CARD" as any,
          transactionId: result.approvalCode ?? result.rrn ?? undefined,
          idempotencyKey: charge.idempotencyKey,
        } as any,
        tenantId,
        initiatedByUserId,
      );
      paymentId = (payment as any)?.payment?.id ?? (payment as any)?.id ?? null;
    } catch (err: any) {
      // The card WAS charged but we can't record it (e.g. amount now exceeds
      // remaining after a concurrent payment). Leave the charge APPROVED (not
      // RECORDED) so the recovery sweep + operator reconciliation pick it up;
      // for fiscal_coupled/real providers this is where a void would fire (P4).
      this.logger.error(
        `Terminal charge ${charge.id} APPROVED but Payment record failed: ${err?.message}`,
      );
      const updated = await this.prisma.paymentTerminalCharge.update({
        where: { id: charge.id },
        data: {
          status: "APPROVED",
          approvalCode: result.approvalCode ?? null,
          rrn: result.rrn ?? null,
          cardBrand: result.cardBrand ?? null,
          maskedPan: result.maskedPan ?? null,
          fiscalNo: result.fiscalNo ?? null,
          error: `record-failed: ${err?.message ?? "unknown"}`,
        },
      });
      return this.toView(updated);
    }

    // Guarded write: only flip to RECORDED while the charge has NOT been voided
    // (or already recorded) since the read above. Pre-fix an unconditional
    // update({where:{id}}) would clobber a VOIDED status set by a concurrent
    // voidCharge() — resurrecting a voided charge with a Payment on the books.
    // If the guard matches 0 rows the void won the race: the just-created
    // Payment is left for reconciliation instead of silently overwriting the
    // void. (CANCELLED is intentionally still recordable — the card approved.)
    const recorded = await this.prisma.paymentTerminalCharge.updateMany({
      where: {
        id: charge.id,
        status: { notIn: ["VOIDED", "RECORDED"] },
        paymentId: null,
      },
      data: {
        status: "RECORDED",
        approvalCode: result.approvalCode ?? null,
        rrn: result.rrn ?? null,
        cardBrand: result.cardBrand ?? null,
        maskedPan: result.maskedPan ?? null,
        fiscalNo: result.fiscalNo ?? null,
        paymentId,
        error: null,
      },
    });
    if (recorded.count === 0) {
      this.logger.error(
        `Terminal charge ${charge.id}: Payment ${paymentId} created but the charge left the recordable state concurrently (likely a void) — flagged for reconciliation, not clobbering.`,
      );
    }
    const updated = await this.prisma.paymentTerminalCharge.findFirst({
      where: { id: charge.id, tenantId },
    });
    // Note: fiscal_coupled providers (GMP-3) already printed the fiş in the
    // sale op — the double-fiş skip is wired in P2. (Simulator is not coupled.)
    void FISCAL_COUPLED;
    return this.toView(updated ?? charge);
  }

  private async markCharge(
    chargeId: string,
    tenantId: string,
    data: { status: string; error?: string },
  ) {
    return this.prisma.paymentTerminalCharge
      .update({
        where: { id: chargeId },
        data: { status: data.status, error: data.error ?? null },
        // scope guard not needed: chargeId is a uuid we just created in-tenant
      })
      .catch(() => undefined);
  }

  /** Recovery attempts before an un-recordable APPROVED charge is parked. */
  private static readonly MAX_RECOVERY_ATTEMPTS = 5;

  /**
   * Crash recovery: a charge that APPROVED but never reached RECORDED (process
   * died between the bank approval and the Payment write) gets reconciled here
   * — re-running the idempotent record. Never double-books (RECORDED short-
   * circuit + Payment idempotencyKey). Mirrors self-pay-recovery.
   *
   * Bounded (P4): a charge that is genuinely un-recordable (e.g. the order was
   * settled by another tender, so create() always rejects) would otherwise be
   * retried every 5 min forever. After MAX_RECOVERY_ATTEMPTS it is parked in
   * NEEDS_REVIEW and drops out of the sweep, surfaced for operator
   * reconciliation via listReconciliation().
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async recoverApprovedUnrecorded() {
    const stuck = await this.prisma.paymentTerminalCharge.findMany({
      where: {
        status: "APPROVED",
        paymentId: null,
        recoveryAttempts: {
          lt: PaymentTerminalService.MAX_RECOVERY_ATTEMPTS,
        },
      },
      take: 50,
      orderBy: { createdAt: "asc" },
    });
    for (const c of stuck) {
      let recorded = false;
      try {
        const provider = this.registry.get(c.providerId);
        const updated = await this.applyResult(
          c.id,
          c.tenantId,
          provider,
          {
            status: "APPROVED",
            approvalCode: c.approvalCode ?? undefined,
            rrn: c.rrn ?? undefined,
            cardBrand: c.cardBrand ?? undefined,
            maskedPan: c.maskedPan ?? undefined,
            fiscalNo: c.fiscalNo ?? undefined,
          },
          null,
        );
        recorded = updated.status === "RECORDED";
      } catch (err: any) {
        this.logger.warn(
          `recoverApprovedUnrecorded: charge ${c.id} still unrecordable: ${err?.message}`,
        );
      }
      if (recorded) continue;
      // Still not recorded — count the failed attempt and park once exhausted.
      // Guarded (status APPROVED + paymentId null): if a concurrent poll
      // recorded the Payment between applyResult and here, this no-ops rather
      // than clobbering a RECORDED charge to NEEDS_REVIEW with money booked.
      const attempts = (c.recoveryAttempts ?? 0) + 1;
      const park = attempts >= PaymentTerminalService.MAX_RECOVERY_ATTEMPTS;
      await this.prisma.paymentTerminalCharge
        .updateMany({
          where: { id: c.id, status: "APPROVED", paymentId: null },
          data: {
            recoveryAttempts: attempts,
            ...(park ? { status: "NEEDS_REVIEW" } : {}),
          },
        })
        .catch(() => undefined);
      if (park) {
        this.logger.error(
          `Terminal charge ${c.id} parked NEEDS_REVIEW after ${attempts} recovery attempts — operator reconciliation required.`,
        );
      }
    }
  }

  /**
   * Charges needing operator attention: APPROVED-but-unrecorded (a card was
   * charged but the Payment didn't land) and NEEDS_REVIEW (recovery exhausted).
   * The durable record for manual reconciliation of a real bank charge.
   */
  async listReconciliation(scope: BranchScope) {
    const rows = await this.prisma.paymentTerminalCharge.findMany({
      where: {
        tenantId: scope.tenantId,
        OR: [{ branchId: scope.branchId }, { branchId: null }],
        AND: [
          {
            OR: [
              { status: "NEEDS_REVIEW" },
              { status: "APPROVED", paymentId: null },
            ],
          },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return rows.map((r) => ({
      chargeId: r.id,
      orderId: r.orderId,
      providerId: r.providerId,
      status: r.status,
      amount: r.amountCents / 100,
      approvalCode: r.approvalCode ?? null,
      rrn: r.rrn ?? null,
      recoveryAttempts: r.recoveryAttempts ?? 0,
      error: r.error ?? null,
      createdAt: r.createdAt,
    }));
  }

  private toView(c: {
    id: string;
    status: string;
    approvalCode?: string | null;
    cardBrand?: string | null;
    maskedPan?: string | null;
    paymentId?: string | null;
    error?: string | null;
    amountCents: number;
    orderId: string;
  }) {
    return {
      chargeId: c.id,
      status: c.status,
      approvalCode: c.approvalCode ?? null,
      cardBrand: c.cardBrand ?? null,
      maskedPan: c.maskedPan ?? null,
      paymentId: c.paymentId ?? null,
      error: c.error ?? null,
      amount: c.amountCents / 100,
      orderId: c.orderId,
    };
  }
}
