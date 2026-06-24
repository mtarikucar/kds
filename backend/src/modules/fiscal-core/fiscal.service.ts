import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { PrismaService } from "../../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { FiscalProviderRegistry } from "./fiscal-provider.registry";
import { FiscalReceiptRequest } from "./fiscal-provider.interface";
import { BranchScope, branchScope } from "../../common/scoping/branch-scope";
import { MetricsService } from "../../common/metrics/metrics.service";
import { captureException } from "../../sentry.config";
import { captureSwallowedEmit } from "../../common/observability/capture-swallowed-emit";

/**
 * Domain service for fiscal receipts. Persists every receipt request to
 * `fiscal_receipts` (queued state), dispatches to the brand-specific
 * adapter, and updates the row with the result. Failures land in
 * `status='failed'` with `lastError`, ready for the manual recovery panel.
 *
 * Idempotency: clients send `idempotencyKey` (UUIDv7 from the producer).
 * The (tenantId, idempotencyKey) unique index dedupes; on retry we return
 * the existing row instead of re-issuing.
 */
@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: FiscalProviderRegistry,
    private readonly outbox: OutboxService,
    // Optional so unit tests constructing the service bare keep working.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  private countIssued(status: string): void {
    this.metrics?.incCounter(
      "fiscal_receipts_issued_total",
      "Fiscal receipts by terminal status (issued|failed)",
      { status },
    );
  }

  /**
   * Register a physical fiscal device (the create-site that was missing —
   * without it the payment-finalizer's yazarkasa path is permanently dormant).
   *
   * Validation:
   *  - providerId must be a registered provider WITH the `receipt` capability
   *    (a physical ÖKC). This naturally rejects `efatura` (capability
   *    `invoice` only) — e-documents are not issued through a fiscal device.
   *  - a linked `deviceId`, when given, must be a real device-mesh row in the
   *    same tenant + branch and of a bridgeable kind (local_bridge / yazarkasa).
   *  - the device starts `offline`; it only goes online once the bridge acks.
   *
   * This does NOT make receipts print — see RegisterFiscalDeviceDto. It only
   * makes the (honest, queue-or-fail) issuance path reachable.
   */
  async registerDevice(
    scope: BranchScope,
    dto: {
      providerId: string;
      serial: string;
      model?: string;
      deviceId?: string;
      branchId?: string;
      config?: Record<string, unknown>;
    },
  ) {
    // Unknown providerId → NotFoundException from the registry.
    const provider = this.registry.get(dto.providerId);
    if (!provider.capabilities.includes("receipt")) {
      throw new BadRequestException(
        `Provider '${dto.providerId}' cannot issue cash receipts (capabilities: ` +
          `${provider.capabilities.join(", ") || "none"}). Register a physical ` +
          `ÖKC provider (fiscal_hugin / fiscal_beko). e-Fatura/e-Arşiv is issued ` +
          `automatically on order payment via the Accounting integration, not here.`,
      );
    }

    const branchId = dto.branchId ?? scope.branchId ?? null;

    // IDOR / integrity: an explicit branchId must belong to THIS tenant. Never
    // write another tenant's (globally-unique) branchId onto our device row.
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, tenantId: scope.tenantId },
        select: { id: true },
      });
      if (!branch) {
        throw new BadRequestException("Branch not found in this tenant.");
      }
    }

    // Validate the optional bridge link: it must be a real device in this
    // tenant + branch, and a kind that can actually carry GMP-3 fiscal
    // commands. We do NOT auto-create it — the operator pairs the bridge via
    // the device-mesh flow first, then links it here.
    if (dto.deviceId) {
      const device = await this.prisma.device.findFirst({
        where: { id: dto.deviceId, tenantId: scope.tenantId },
        select: { id: true, kind: true, branchId: true },
      });
      if (!device) {
        throw new BadRequestException(
          "Linked device not found — pair the local bridge / yazarkasa in " +
            "Devices first, then link it here.",
        );
      }
      if (!["local_bridge", "yazarkasa"].includes(device.kind)) {
        throw new BadRequestException(
          `Linked device is a '${device.kind}', not a bridge/yazarkasa. A ` +
            `GMP-3 ÖKC must be wired through a local_bridge or yazarkasa device.`,
        );
      }
      if (branchId && device.branchId !== branchId) {
        throw new BadRequestException(
          "Linked device belongs to a different branch.",
        );
      }
    }

    try {
      return await this.prisma.fiscalDeviceRecord.create({
        data: {
          id: uuidv7(),
          tenantId: scope.tenantId,
          branchId,
          providerId: dto.providerId,
          deviceId: dto.deviceId ?? null,
          serial: dto.serial,
          model: dto.model ?? null,
          capabilities: provider.capabilities,
          status: "offline",
          config: (dto.config ?? undefined) as any,
        },
      });
    } catch (e) {
      // @@unique([tenantId, providerId, serial]) — a re-register of the same
      // serial is a conflict, not a 500.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new ConflictException(
          `A '${dto.providerId}' device with serial '${dto.serial}' is already ` +
            `registered for this tenant.`,
        );
      }
      throw e;
    }
  }

  /** List fiscal devices in the active branch scope. */
  async listDevices(scope: BranchScope) {
    const rows = await this.prisma.fiscalDeviceRecord.findMany({
      where: branchScope(scope),
      orderBy: { createdAt: "desc" },
    });
    // Strip provider `config` from the list view — it may hold a station code
    // or (future) provider credentials, and operators don't need the raw blob
    // to manage devices. Registration still accepts it.
    return rows.map(({ config: _config, ...rest }) => rest);
  }

  /**
   * Retire a fiscal device — decommissions it (issueReceipt/closeDay both
   * refuse a retired device). Idempotent on an already-retired row.
   */
  async retireDevice(scope: BranchScope, fiscalDeviceId: string) {
    const device = await this.prisma.fiscalDeviceRecord.findFirst({
      where: { id: fiscalDeviceId, ...branchScope(scope) },
    });
    if (!device) throw new NotFoundException("Fiscal device not found");
    if (device.status === "retired") return device;
    return this.prisma.fiscalDeviceRecord.update({
      where: { id: device.id },
      data: { status: "retired" },
    });
  }

  async issueReceipt(req: FiscalReceiptRequest) {
    // Compound WHERE — same defense-in-depth pattern as iter-35
    // device-mesh findOrThrow. Fiscal records are TR-law-mandated
    // financial data; an id-only lookup that returns the row to a
    // later step (status check, provider dispatch) is too brittle.
    const device = await this.prisma.fiscalDeviceRecord.findFirst({
      where: { id: req.fiscalDeviceId, tenantId: req.tenantId },
    });
    if (!device) {
      throw new NotFoundException("Fiscal device not found");
    }
    if (device.status === "retired")
      throw new BadRequestException("Fiscal device retired");

    // Idempotency check.
    const existing = await this.prisma.fiscalReceipt.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId: req.tenantId,
          idempotencyKey: req.idempotencyKey,
        },
      },
    });
    if (existing) return existing;

    const totalCents = req.lines.reduce(
      (acc, l) =>
        acc + Math.round(l.qty * l.unitPriceCents) - (l.discountCents ?? 0),
      0,
    );
    const vatBreakdown: Record<string, number> = {};
    for (const l of req.lines) {
      const vat = Math.round(
        ((l.qty * l.unitPriceCents - (l.discountCents ?? 0)) * l.vatRate) /
          (100 + l.vatRate),
      );
      const k = String(l.vatRate);
      vatBreakdown[k] = (vatBreakdown[k] ?? 0) + vat;
    }

    // Persist queued row.
    const row = await this.prisma.fiscalReceipt.create({
      data: {
        id: uuidv7(),
        tenantId: req.tenantId,
        // Branch the receipt was issued at. Prefer the explicit request
        // branch (POS terminal that produced it); fall back to the
        // device's home branch for legacy/automated callers.
        branchId: req.branchId ?? device.branchId ?? null,
        orderId: req.orderId,
        fiscalDeviceId: req.fiscalDeviceId,
        providerId: device.providerId,
        totalCents,
        vatBreakdown: vatBreakdown as any,
        idempotencyKey: req.idempotencyKey,
        status: "queued",
        lines: {
          create: req.lines.map((l, i) => ({
            id: uuidv7(),
            lineNo: i + 1,
            productCode: l.productCode,
            name: l.name,
            qty: new Prisma.Decimal(l.qty),
            unitPriceCents: l.unitPriceCents,
            vatRate: l.vatRate,
            vatGroup: l.vatGroup,
            discountCents: l.discountCents ?? 0,
          })),
        },
      },
    });

    // Hand off to provider. We do not retry inside this call — the outbox
    // worker (downstream consumer of fiscal.receipt.failed.v1) handles retry
    // with backoff.
    const provider = this.registry.get(device.providerId);
    try {
      const result = await provider.issueReceipt(req);
      // Honour the provider's THREE-state result. For on-prem ÖKC (GMP-3) the
      // normal case is `queued`: the receipt was enqueued onto the device-mesh
      // and the bridge has not acked yet. A `queued` result MUST stay queued —
      // it is NOT a failure (no fiscal.receipt.failed.v1, no `failed` count)
      // and NOT an issuance. Only `issued` flips the row to issued; only
      // `failed` flips it to failed. The e-Fatura adapter is an honesty shim
      // that returns `failed` synchronously (it never issues — e-documents go
      // through the Accounting rail on order payment).
      const nextStatus =
        result.status === "issued"
          ? "issued"
          : result.status === "queued"
            ? "queued"
            : "failed";
      const updated = await this.prisma.fiscalReceipt.update({
        where: { id: row.id },
        data: {
          status: nextStatus,
          fiscalNo: result.fiscalNo,
          fiscalZNo: result.fiscalZNo,
          issuedAt: nextStatus === "issued" ? new Date() : null,
          lastError: nextStatus === "failed" ? result.error : null,
        },
      });
      // Only terminal outcomes (issued|failed) move the metric; a still-queued
      // receipt has no terminal status yet.
      if (nextStatus !== "queued") this.countIssued(updated.status);
      // Emit a domain event only on a terminal outcome. A `queued` receipt
      // stays silent until the bridge acks (the recovery/outbox path emits
      // printed/failed then) — emitting `failed` here would falsely mark an
      // in-flight fiscal print as failed.
      if (nextStatus !== "queued") {
        await this.outbox
          .append({
            type:
              nextStatus === "issued"
                ? "fiscal.receipt.printed.v1"
                : "fiscal.receipt.failed.v1",
            tenantId: req.tenantId,
            payload: {
              fiscalReceiptId: updated.id,
              fiscalDeviceId: req.fiscalDeviceId,
              fiscalNo: result.fiscalNo,
              error: result.error,
            },
          })
          .catch(
            captureSwallowedEmit(this.logger, {
              module: "fiscal-core",
              op: "issueReceipt",
            }),
          );
      }
      return updated;
    } catch (e) {
      // Compliance-critical money path — the provider dispatch threw. This was
      // logged-only before; surface it to Sentry (correlation id auto-attached)
      // so a fiscal-device outage is alertable, not silently swallowed.
      captureException(e as Error, {
        module: "fiscal-core",
        op: "issueReceipt",
        fiscalDeviceId: req.fiscalDeviceId,
        tenantId: req.tenantId,
      });
      this.countIssued("failed");
      const updated = await this.prisma.fiscalReceipt.update({
        where: { id: row.id },
        data: {
          status: "failed",
          lastError: (e as Error).message,
          attempts: { increment: 1 },
        },
      });
      await this.outbox
        .append({
          type: "fiscal.receipt.failed.v1",
          tenantId: req.tenantId,
          payload: { fiscalReceiptId: updated.id, error: (e as Error).message },
        })
        .catch(
          captureSwallowedEmit(this.logger, {
            module: "fiscal-core",
            op: "issueReceipt",
          }),
        );
      return updated;
    }
  }

  /**
   * Recovery-read scope: the active branch PLUS branchless orphans. A receipt
   * issued by a device with no branch (fiscal_devices.branchId NULL → receipt
   * branchId NULL) would otherwise be invisible to every per-branch recovery
   * read and stuck forever. Including NULL makes those orphans actionable from
   * any branch's panel; branchId is a globally-unique FK, so this never
   * exposes another branch's owned receipts — only the unowned orphans.
   */
  private recoveryScope(scope: BranchScope) {
    return {
      tenantId: scope.tenantId,
      OR: [{ branchId: scope.branchId }, { branchId: null }],
    };
  }

  async cancelReceipt(
    scope: BranchScope,
    fiscalReceiptId: string,
    reason: string,
  ) {
    const row = await this.prisma.fiscalReceipt.findFirst({
      where: { id: fiscalReceiptId, ...this.recoveryScope(scope) },
    });
    if (!row) throw new NotFoundException("Receipt not found");
    if (row.status !== "issued")
      throw new BadRequestException("Only issued receipts can be cancelled");
    const provider = this.registry.get(row.providerId);
    await provider.cancelReceipt(fiscalReceiptId, reason);
    return this.prisma.fiscalReceipt.update({
      where: { id: row.id },
      data: { status: "cancelled", lastError: `cancelled: ${reason}` },
    });
  }

  async closeDay(scope: BranchScope, fiscalDeviceId: string) {
    // closeDay runs a Z report for ONE device, and a device lives in one
    // branch. Scope the lookup so a branch-A operator can't close the day
    // on a branch-B device by guessing its id (cross-branch IDOR).
    const device = await this.prisma.fiscalDeviceRecord.findFirst({
      where: { id: fiscalDeviceId, ...branchScope(scope) },
    });
    if (!device) throw new NotFoundException("Fiscal device not found");
    // Mirror issueReceipt's retired-device gate. A retired yazarkasa
    // can't legally produce a Z report (the unit is decommissioned and
    // its counters frozen at the time of retirement), so the operator
    // probably wanted to close the day on a DIFFERENT device. Surface
    // that with a clean 400 rather than letting it fail mid-adapter.
    if (device.status === "retired") {
      throw new BadRequestException("Fiscal device retired — cannot close day");
    }
    const provider = this.registry.get(device.providerId);
    // The provider dispatch is asynchronous for on-prem ÖKC adapters (GMP-3):
    // closeDay() THROWS a retryable conflict while the device has not yet
    // acked the Z report, so a thrown error here means the day-close did not
    // run — we must NOT persist a fiscalDayClose row or emit
    // fiscal.day.closed.v1 (both happen below only on a real, returned report).
    const report = await provider.closeDay(fiscalDeviceId);
    // Defence in depth: never record a legally-binding day-close without a
    // real Z number. A provider that returns a report with an empty/missing
    // zNo (un-acked, or a placeholder) is treated as "not closed yet" — surface
    // it as a retryable conflict instead of writing a fabricated row.
    if (!report.zNo) {
      throw new ConflictException(
        "Fiscal day-close has no Z number yet — the ÖKC has not acked the Z report. " +
          "Reconcile from the recovery panel once the device confirms.",
      );
    }
    await this.prisma.fiscalDayClose.create({
      data: {
        id: uuidv7(),
        tenantId: scope.tenantId,
        fiscalDeviceId,
        zNo: report.zNo,
        openedAt: new Date(report.openedAt),
        closedAt: new Date(report.closedAt),
        totals: report.totals as any,
      },
    });
    await this.outbox
      .append({
        type: "fiscal.day.closed.v1",
        tenantId: scope.tenantId,
        payload: { fiscalDeviceId, zNo: report.zNo },
      })
      .catch(
        captureSwallowedEmit(this.logger, {
          module: "fiscal-core",
          op: "closeDay",
        }),
      );
    return report;
  }

  /** List receipts in queued/failed state — for the manual recovery panel. */
  async listPending(scope: BranchScope, limit = 100) {
    return this.prisma.fiscalReceipt.findMany({
      where: {
        ...this.recoveryScope(scope),
        status: { in: ["queued", "failed"] },
      },
      include: { lines: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  /**
   * Manual recovery: re-dispatch a queued/failed receipt to its adapter.
   *
   * Keeps the original `idempotencyKey` so a successful retry won't create
   * a duplicate at the provider. Used by the ops "manual recovery panel"
   * when the adapter recovered from a transient failure (printer was wedged,
   * yazarkasa serial port hung, GİB API was down) and the receipt can now
   * be issued without re-keying.
   */
  // Cooldown between retries of the same receipt. Without this, an
  // operator spam-clicking Retry while the printer is wedged can stack
  // dozens of concurrent requests and crash the device (real-world
  // yazarkasa drivers do not handle parallel writes gracefully).
  private static readonly RETRY_COOLDOWN_MS = 30_000;

  async retryFailed(scope: BranchScope, fiscalReceiptId: string) {
    const row = await this.prisma.fiscalReceipt.findFirst({
      where: { id: fiscalReceiptId, ...this.recoveryScope(scope) },
      include: { lines: true, fiscalDevice: true },
    });
    if (!row) throw new NotFoundException("Receipt not found");
    if (row.status === "issued") return row; // already succeeded
    if (row.status === "cancelled") {
      throw new BadRequestException("Cannot retry a cancelled receipt");
    }

    // Cooldown gate. `updatedAt` bumps on each retry attempt (the next
    // step's update sets a new status/lastError, refreshing it). Reject
    // if the last touch was within the cooldown window.
    const sinceLast = Date.now() - row.updatedAt.getTime();
    if (sinceLast < FiscalService.RETRY_COOLDOWN_MS) {
      const waitMs = FiscalService.RETRY_COOLDOWN_MS - sinceLast;
      throw new BadRequestException(
        `Cooldown active — retry in ${Math.ceil(waitMs / 1000)}s. The previous attempt's outcome may still be in flight.`,
      );
    }

    const provider = this.registry.get(row.providerId);
    try {
      const result = await provider.issueReceipt({
        tenantId: scope.tenantId,
        branchId: row.branchId ?? undefined,
        fiscalDeviceId: row.fiscalDeviceId,
        orderId: row.orderId ?? undefined,
        idempotencyKey: row.idempotencyKey, // SAME key — provider dedupes
        lines: row.lines.map((l) => ({
          productCode: l.productCode,
          name: l.name,
          qty: Number(l.qty),
          unitPriceCents: l.unitPriceCents,
          vatRate: l.vatRate,
          vatGroup: l.vatGroup ?? undefined,
          discountCents: l.discountCents,
        })),
        // Payments are not persisted on the receipt row today; the orders
        // module owns them. The adapter only needs them for split/payment
        // breakdowns on the device — TR yazarkasa accepts a single-line
        // payment summary equal to the total, which is what we emit here.
        payments: [{ method: "cash", amountCents: row.totalCents }],
      });

      // Same three-state contract as the initial dispatch. On recovery the ÖKC
      // re-dispatch most often comes back `queued` again (the bridge re-claims
      // the SAME idempotent command row and has not re-acked yet) — that must
      // stay `queued`, NOT be re-marked `failed`. Otherwise a healthy in-flight
      // print would oscillate failed→queued→failed on every retry click.
      const nextStatus =
        result.status === "issued"
          ? "issued"
          : result.status === "queued"
            ? "queued"
            : "failed";
      const updated = await this.prisma.fiscalReceipt.update({
        where: { id: row.id },
        data: {
          status: nextStatus,
          fiscalNo: result.fiscalNo,
          fiscalZNo: result.fiscalZNo,
          issuedAt: nextStatus === "issued" ? new Date() : null,
          lastError: nextStatus === "failed" ? result.error : null,
          attempts: { increment: 1 },
        },
      });

      // Terminal outcomes only — a still-queued retry stays silent.
      if (nextStatus !== "queued") {
        await this.outbox
          .append({
            type:
              nextStatus === "issued"
                ? "fiscal.receipt.printed.v1"
                : "fiscal.receipt.failed.v1",
            tenantId: scope.tenantId,
            payload: {
              fiscalReceiptId: updated.id,
              fiscalDeviceId: row.fiscalDeviceId,
              fiscalNo: result.fiscalNo,
              error: result.error,
              retried: true,
            },
          })
          .catch(
            captureSwallowedEmit(this.logger, {
              module: "fiscal-core",
              op: "retryFailed",
            }),
          );
      }

      return updated;
    } catch (e) {
      const updated = await this.prisma.fiscalReceipt.update({
        where: { id: row.id },
        data: {
          status: "failed",
          lastError: (e as Error).message,
          attempts: { increment: 1 },
        },
      });
      this.logger.warn(
        `Retry failed for receipt=${row.id}: ${(e as Error).message}`,
      );
      return updated;
    }
  }
}
