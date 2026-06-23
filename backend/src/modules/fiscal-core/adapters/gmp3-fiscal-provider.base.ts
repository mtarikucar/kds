import { Logger, NotFoundException } from "@nestjs/common";
import {
  FiscalCapability,
  FiscalDeviceStatus,
  FiscalLine,
  FiscalPaymentLine,
  FiscalProvider,
  FiscalReceiptRequest,
  FiscalReceiptResult,
  ZReport,
} from "../fiscal-provider.interface";
import { FiscalProviderRegistry } from "../fiscal-provider.registry";
import { PrismaService } from "../../../prisma/prisma.service";
import { CommandQueueService } from "../../device-mesh/command-queue.service";

/**
 * Real GMP-3 / TSM yazarkasa (ÖKC — Ödeme Kaydedici Cihaz) base adapter.
 *
 * In Turkey a "new generation" yazarkasa (YN ÖKC) speaks the GMP-3
 * (GİB Mali Protokol v3) message family over its local ECR/serial interface
 * and reports to the GİB through the TSM (Trusted Service Manager). The
 * cloud has no direct line to the device: the unit is wired through the
 * branch's `local_bridge` agent. So issuance is intrinsically asynchronous —
 * we cannot synchronously "print" from the cloud.
 *
 * Transport: this adapter does NOT open a serial port. It enqueues a
 * `fiscal_receipt` / `fiscal_cancel` / GMP-3 report command onto the
 * device-mesh command queue (CommandQueueService). The branch's local_bridge
 * claims the command, drives the vendor SDK against the physically-attached
 * ÖKC, and acks the result back onto the same `DeviceCommand` row. We then
 * read that row back, correlating by the `idempotencyKey`, and map the
 * bridge/device outcome onto a {@link FiscalReceiptResult}:
 *
 *   bridge ack `done`           → issued  (fiscalNo/fiscalZNo from the ack result)
 *   bridge ack `failed`         → failed
 *   still queued/inflight/none  → queued  (caller persists 'queued'; the outbox
 *                                          retry / manual-recovery panel reconciles)
 *
 * The command kind is intentionally one of the device-mesh NON_RETRYABLE_KINDS
 * (`fiscal_receipt`, `fiscal_cancel`): a fiscal print is a legally-binding,
 * non-idempotent side effect, so the server never auto-redelivers a lost ack —
 * a duplicate fiscal receipt is a tax exposure. Idempotency is enforced at the
 * queue layer on (deviceId, idempotencyKey): the same key re-enqueues to the
 * SAME row, so a retry round-trips to the original command's outcome instead
 * of burning a second fiscal number.
 *
 * Subclasses (Hugin, Beko) set vendor specifics: the protocol profile string
 * the bridge dispatches to the right SDK, the payment-method → GMP-3 tender
 * code map, and the default KDV-rate → department (A–F) map.
 */

/**
 * GMP-3 fiscal department group. TR yazarkasalar bucket each line into one of
 * eight departments (A–H historically; A–F are the KDV-bearing groups used in
 * hospitality). Each department carries a configured KDV rate on the device.
 */
export type Gmp3Department = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

/** GMP-3 tender/payment code the ÖKC understands on a payment line. */
export type Gmp3TenderCode =
  | "NAKIT" // cash
  | "KREDI_KARTI" // bank/credit card
  | "QR" // QR / wallet
  | "YEMEK_FISI" // ticket (sodexo/multinet/...)
  | "DIGER"; // voucher / other

/**
 * One GMP-3 receipt line as the bridge SDK expects it. Money stays in integer
 * minor units (kuruş) end-to-end — yazarkasa firmware is integer-only and
 * floating TRY would drift the KDV rounding the device computes internally.
 */
export interface Gmp3CommandLine {
  productCode: string;
  name: string;
  /** Quantity in milli-units (qty * 1000) — GMP-3 carries 3-decimal qty. */
  quantityMilli: number;
  unitPriceCents: number;
  /** KDV percentage (0,1,8,10,18,20). */
  vatRate: number;
  /** Department group A–H this line is rung up under. */
  department: Gmp3Department;
  discountCents: number;
}

/** One GMP-3 payment line. */
export interface Gmp3CommandPayment {
  tender: Gmp3TenderCode;
  amountCents: number;
  /** Card scheme / ticket brand passthrough (VISA, multinet, ...). */
  brand?: string;
}

/**
 * The `fiscal_receipt` command payload the local_bridge claims off the queue.
 * `protocol: 'GMP3'` + `vendorProfile` tell the bridge which vendor SDK to
 * load; `sdkVersion` is the minimum protocol revision the bridge must satisfy.
 */
export interface Gmp3FiscalReceiptCommand {
  protocol: "GMP3";
  vendorProfile: string;
  sdkVersion: string;
  /** FiscalDeviceRecord serial — the bridge maps it to the attached COM port. */
  fiscalSerial: string;
  tenantId: string;
  branchId?: string;
  orderId?: string;
  customer?: { taxId?: string; name?: string; addr?: string };
  lines: Gmp3CommandLine[];
  payments: Gmp3CommandPayment[];
  /** 'cash_receipt' (fiş) | 'einvoice' | 'earsiv' — ÖKC prints fiş only. */
  kind: "cash_receipt" | "einvoice" | "earsiv";
}

/** Payload for a GMP-3 fiscal void (cancel) command. */
export interface Gmp3FiscalCancelCommand {
  protocol: "GMP3";
  vendorProfile: string;
  fiscalSerial: string;
  /** The fiscal receipt id we are voiding. */
  receiptId: string;
  reason: string;
}

/** Payload for a GMP-3 X/Z report or day-close command. */
export interface Gmp3ReportCommand {
  protocol: "GMP3";
  vendorProfile: string;
  fiscalSerial: string;
  report: "X" | "Z";
  /** Business date (yyyy-mm-dd) the report is requested for. */
  date: string;
}

/**
 * Shape the bridge writes back into DeviceCommand.result after driving the
 * vendor SDK. Every field is optional because a `failed` ack may carry only
 * an error; we read defensively and never assume the device populated a key.
 */
export interface Gmp3CommandResult {
  /** Mali fiş no / fiscal receipt number the ÖKC printed. */
  fiscalNo?: string;
  /** Current Z counter (EKÜ/Z no) at print time. */
  fiscalZNo?: string;
  /** Z report number for a day-close. */
  zNo?: string;
  openedAt?: string;
  closedAt?: string;
  /** Department/tender totals from an X/Z report, in kuruş. */
  totals?: Record<string, number>;
  /** ÖKC device status word, when the command was a probe. */
  deviceStatus?: "online" | "offline" | "error" | "maintenance";
  error?: string;
  /** Raw vendor SDK frame for audit. */
  raw?: Record<string, unknown>;
}

/** Minimal projection of a DeviceCommand row this adapter reads back. */
interface CorrelatedCommand {
  status: string;
  result: unknown;
  error: string | null;
}

export abstract class Gmp3FiscalProviderBase implements FiscalProvider {
  abstract readonly id: string;
  readonly capabilities: FiscalCapability[] = [
    "receipt",
    "z_report",
    "x_report",
    "cancel",
  ];

  /**
   * Protocol profile the local_bridge dispatches on to pick the vendor SDK
   * (e.g. "hugin.gmp3", "beko.gmp3"). Modelled explicitly rather than faked —
   * the actual serial framing lives in the vendor SDK on the bridge.
   */
  protected abstract readonly vendorProfile: string;
  /** Minimum GMP-3 SDK revision the bridge must satisfy for this vendor. */
  protected abstract readonly sdkVersion: string;

  protected abstract readonly logger: Logger;

  protected constructor(
    protected readonly registry: FiscalProviderRegistry,
    protected readonly prisma: PrismaService,
    protected readonly commandQueue: CommandQueueService,
  ) {}

  /**
   * Map a KDV rate to a yazarkasa department group. ÖKC departments are
   * configured on the device per-rate; this is the conventional TR hospitality
   * layout. A subclass may override if a vendor's factory layout differs.
   */
  protected readonly departmentByVatRate: Record<number, Gmp3Department> = {
    0: "A",
    1: "B",
    8: "C",
    10: "D",
    18: "E",
    20: "F",
  };

  /** Map the neutral payment method to the vendor's GMP-3 tender code. */
  protected tenderFor(method: FiscalPaymentLine["method"]): Gmp3TenderCode {
    switch (method) {
      case "cash":
        return "NAKIT";
      case "card":
        return "KREDI_KARTI";
      case "qr":
        return "QR";
      case "ticket":
        return "YEMEK_FISI";
      case "voucher":
        return "DIGER";
    }
  }

  protected departmentFor(line: FiscalLine): Gmp3Department {
    // An explicit vatGroup from the caller wins (operator overrode the dept).
    if (line.vatGroup && this.isDepartment(line.vatGroup)) {
      return line.vatGroup;
    }
    const dept = this.departmentByVatRate[line.vatRate];
    if (!dept) {
      // No configured department for this rate — surface it rather than
      // silently ringing it up under the wrong KDV group (a tax error).
      throw new NotFoundException(
        `No GMP-3 department configured for KDV rate ${line.vatRate}% on ${this.id}`,
      );
    }
    return dept;
  }

  private isDepartment(v: string): v is Gmp3Department {
    return ["A", "B", "C", "D", "E", "F", "G", "H"].includes(v);
  }

  protected buildLines(lines: FiscalLine[]): Gmp3CommandLine[] {
    return lines.map((l) => ({
      productCode: l.productCode,
      name: l.name,
      quantityMilli: Math.round(l.qty * 1000),
      unitPriceCents: l.unitPriceCents,
      vatRate: l.vatRate,
      department: this.departmentFor(l),
      discountCents: l.discountCents ?? 0,
    }));
  }

  protected buildPayments(payments: FiscalPaymentLine[]): Gmp3CommandPayment[] {
    return payments.map((p) => ({
      tender: this.tenderFor(p.method),
      amountCents: p.amountCents,
      brand: p.brand,
    }));
  }

  /**
   * Resolve the FiscalDeviceRecord for this request and the mesh `deviceId`
   * (the local_bridge / yazarkasa) the command must be enqueued to. A cloud
   * fiscal record with no linked mesh device cannot be driven by an on-prem
   * ÖKC adapter — surface that explicitly.
   */
  protected async resolveMeshDevice(
    tenantId: string,
    fiscalDeviceId: string,
  ): Promise<{
    meshDeviceId: string;
    serial: string;
    branchId: string | null;
  }> {
    const record = await this.prisma.fiscalDeviceRecord.findFirst({
      where: { id: fiscalDeviceId, tenantId, providerId: this.id },
      select: { deviceId: true, serial: true, branchId: true },
    });
    if (!record) {
      throw new NotFoundException(
        `Fiscal device ${fiscalDeviceId} not found for provider ${this.id}`,
      );
    }
    if (!record.deviceId) {
      throw new NotFoundException(
        `Fiscal device ${fiscalDeviceId} has no linked mesh device (local_bridge); cannot drive an on-prem ${this.id} ÖKC`,
      );
    }
    return {
      meshDeviceId: record.deviceId,
      serial: record.serial,
      branchId: record.branchId,
    };
  }

  /**
   * Read back the command we enqueued, correlated by (deviceId,
   * idempotencyKey). The enqueue is idempotent on that pair, so after a
   * retry this returns the original command's current state — including a
   * `done`/`failed` ack the bridge may already have written.
   */
  protected async readCorrelated(
    meshDeviceId: string,
    idempotencyKey: string,
  ): Promise<CorrelatedCommand | null> {
    const cmd = await this.prisma.deviceCommand.findUnique({
      where: {
        deviceId_idempotencyKey: { deviceId: meshDeviceId, idempotencyKey },
      },
      select: { status: true, result: true, error: true },
    });
    return cmd ?? null;
  }

  /** Narrow the JSON result blob the bridge wrote into a typed view. */
  protected parseResult(result: unknown): Gmp3CommandResult {
    if (result && typeof result === "object") {
      return result as Gmp3CommandResult;
    }
    return {};
  }

  /**
   * Map a correlated DeviceCommand state onto a FiscalReceiptResult.
   *   done   → issued (carry fiscalNo/fiscalZNo from the ack result)
   *   failed → failed
   *   else   → queued (in flight / not yet claimed)
   */
  protected mapReceiptOutcome(
    receiptId: string,
    cmd: CorrelatedCommand | null,
  ): FiscalReceiptResult {
    if (!cmd) {
      return { providerId: this.id, receiptId, status: "queued" };
    }
    const parsed = this.parseResult(cmd.result);
    if (cmd.status === "done") {
      return {
        providerId: this.id,
        receiptId,
        fiscalNo: parsed.fiscalNo,
        fiscalZNo: parsed.fiscalZNo,
        status: "issued",
        raw: parsed.raw,
      };
    }
    if (cmd.status === "failed" || cmd.status === "expired") {
      return {
        providerId: this.id,
        receiptId,
        status: "failed",
        error: cmd.error ?? parsed.error ?? "Fiscal command failed on device",
        raw: parsed.raw,
      };
    }
    // queued | inflight → still pending on the device.
    return { providerId: this.id, receiptId, status: "queued" };
  }

  // -------------------------------------------------------------------------
  // FiscalProvider implementation
  // -------------------------------------------------------------------------

  /**
   * Idempotent: same idempotencyKey → same enqueued command → same receiptId.
   * The receiptId we return is the caller's idempotencyKey so the fiscal-core
   * service can correlate the queued receipt with the eventual bridge ack.
   */
  async issueReceipt(req: FiscalReceiptRequest): Promise<FiscalReceiptResult> {
    const { meshDeviceId, serial, branchId } = await this.resolveMeshDevice(
      req.tenantId,
      req.fiscalDeviceId,
    );

    const command: Gmp3FiscalReceiptCommand = {
      protocol: "GMP3",
      vendorProfile: this.vendorProfile,
      sdkVersion: this.sdkVersion,
      fiscalSerial: serial,
      tenantId: req.tenantId,
      branchId: req.branchId ?? branchId ?? undefined,
      orderId: req.orderId,
      customer: req.customer,
      lines: this.buildLines(req.lines),
      payments: this.buildPayments(req.payments),
      kind: req.kind ?? "cash_receipt",
    };

    try {
      // Enqueue is idempotent on (deviceId, idempotencyKey): a retry re-binds
      // to the SAME DeviceCommand row rather than printing a second fiş. The
      // queue forwards the branch scope so a branch-restricted operator can't
      // drive an ÖKC in another branch.
      await this.commandQueue.enqueue(
        req.tenantId,
        meshDeviceId,
        {
          kind: "fiscal_receipt",
          payload: command as unknown as Record<string, unknown>,
          // Fiscal prints jump ahead of cosmetic device traffic.
          priority: 10,
          idempotencyKey: req.idempotencyKey,
        },
        req.branchId,
      );
    } catch (e) {
      this.logger.warn(
        `Failed to enqueue ${this.id} fiscal_receipt (idem=${req.idempotencyKey}): ${(e as Error).message}`,
      );
      return {
        providerId: this.id,
        receiptId: req.idempotencyKey,
        status: "failed",
        error: `enqueue failed: ${(e as Error).message}`,
      };
    }

    // Correlate: read the command back. If the bridge has already acked
    // (fast on-prem round-trip), we surface issued/failed immediately;
    // otherwise the receipt stays queued for the recovery panel / outbox.
    const cmd = await this.readCorrelated(meshDeviceId, req.idempotencyKey);
    return this.mapReceiptOutcome(req.idempotencyKey, cmd);
  }

  async cancelReceipt(receiptId: string, reason: string): Promise<void> {
    // A GMP-3 void must run on the SAME ÖKC that printed the receipt. The
    // fiscal-core service passes the FiscalReceipt id as `receiptId`; resolve
    // the originating fiscal device + its mesh bridge from that receipt.
    const receipt = await this.prisma.fiscalReceipt.findFirst({
      where: { id: receiptId, providerId: this.id },
      select: { tenantId: true, fiscalDeviceId: true, branchId: true },
    });
    if (!receipt) {
      throw new NotFoundException(
        `Fiscal receipt ${receiptId} not found for provider ${this.id}`,
      );
    }
    const { meshDeviceId, serial } = await this.resolveMeshDevice(
      receipt.tenantId,
      receipt.fiscalDeviceId,
    );
    const command: Gmp3FiscalCancelCommand = {
      protocol: "GMP3",
      vendorProfile: this.vendorProfile,
      fiscalSerial: serial,
      receiptId,
      reason,
    };
    await this.commandQueue.enqueue(
      receipt.tenantId,
      meshDeviceId,
      {
        kind: "fiscal_cancel",
        payload: command as unknown as Record<string, unknown>,
        priority: 10,
        // A void is itself a non-idempotent fiscal side effect; key it on the
        // receipt so a double-click voids once, not twice.
        idempotencyKey: `cancel:${receiptId}`,
      },
      receipt.branchId ?? undefined,
    );
  }

  async reprintReceipt(receiptId: string): Promise<void> {
    // A reprint (mali olmayan / "non-fiscal" customer copy) is cosmetic, not
    // a fiscal side effect. Route it as a low-priority print on the bridge.
    const receipt = await this.prisma.fiscalReceipt.findFirst({
      where: { id: receiptId, providerId: this.id },
      select: { tenantId: true, fiscalDeviceId: true, branchId: true },
    });
    if (!receipt) {
      throw new NotFoundException(
        `Fiscal receipt ${receiptId} not found for provider ${this.id}`,
      );
    }
    const { meshDeviceId, serial } = await this.resolveMeshDevice(
      receipt.tenantId,
      receipt.fiscalDeviceId,
    );
    await this.commandQueue.enqueue(
      receipt.tenantId,
      meshDeviceId,
      {
        kind: "print_receipt",
        payload: {
          protocol: "GMP3",
          vendorProfile: this.vendorProfile,
          fiscalSerial: serial,
          reprintReceiptId: receiptId,
        },
        priority: 0,
        idempotencyKey: `reprint:${receiptId}:${Date.now()}`,
      },
      receipt.branchId ?? undefined,
    );
  }

  async status(fiscalDeviceId: string): Promise<FiscalDeviceStatus> {
    // Reflect the FiscalDeviceRecord's last-known status. A live probe would
    // round-trip a capability_probe through the bridge; the persisted status
    // (updated by heartbeats / acks) is the cloud's source of truth here.
    const record = await this.prisma.fiscalDeviceRecord.findFirst({
      where: { id: fiscalDeviceId, providerId: this.id },
      select: { status: true, lastSeenAt: true, serial: true },
    });
    if (!record) {
      return { providerId: this.id, fiscalDeviceId, status: "offline" };
    }
    const status = this.normalizeDeviceStatus(record.status);
    return {
      providerId: this.id,
      fiscalDeviceId,
      status,
      details: {
        serial: record.serial,
        lastSeenAt: record.lastSeenAt?.toISOString() ?? null,
        vendorProfile: this.vendorProfile,
      },
    };
  }

  private normalizeDeviceStatus(s: string): FiscalDeviceStatus["status"] {
    switch (s) {
      case "online":
        return "online";
      case "error":
        return "error";
      case "maintenance":
        return "maintenance";
      default:
        return "offline";
    }
  }

  async zReport(fiscalDeviceId: string, date: Date): Promise<ZReport> {
    return this.runReport(fiscalDeviceId, date, "Z");
  }

  async closeDay(fiscalDeviceId: string): Promise<ZReport> {
    // Day-close on a GMP-3 ÖKC IS the Z report — it freezes the day's
    // counters and emits the Z. closeDay is therefore a Z run for "today".
    return this.runReport(fiscalDeviceId, new Date(), "Z");
  }

  protected async runReport(
    fiscalDeviceId: string,
    date: Date,
    report: "X" | "Z",
  ): Promise<ZReport> {
    // resolveMeshDevice needs a tenant; the report is invoked by the
    // fiscal-core service which has already scoped the device, but the
    // FiscalProvider interface only hands us the device id. Look the record
    // up by (id, provider) to recover its tenant + mesh device.
    const record = await this.prisma.fiscalDeviceRecord.findFirst({
      where: { id: fiscalDeviceId, providerId: this.id },
      select: { tenantId: true, deviceId: true, serial: true },
    });
    if (!record || !record.deviceId) {
      throw new NotFoundException(
        `Fiscal device ${fiscalDeviceId} not linked to a mesh bridge for ${this.id}`,
      );
    }
    const dateStr = date.toISOString().slice(0, 10);
    const command: Gmp3ReportCommand = {
      protocol: "GMP3",
      vendorProfile: this.vendorProfile,
      fiscalSerial: record.serial,
      report,
      date: dateStr,
    };
    const idempotencyKey = `${report.toLowerCase()}report:${fiscalDeviceId}:${dateStr}`;
    await this.commandQueue.enqueue(record.tenantId, record.deviceId, {
      kind: report === "Z" ? "fiscal_receipt" : "capability_probe",
      payload: command as unknown as Record<string, unknown>,
      priority: 5,
      idempotencyKey,
    });
    const cmd = await this.readCorrelated(record.deviceId, idempotencyKey);
    const parsed = this.parseResult(cmd?.result);
    const nowIso = new Date().toISOString();
    return {
      providerId: this.id,
      fiscalDeviceId,
      zNo: parsed.zNo ?? parsed.fiscalZNo ?? "",
      openedAt: parsed.openedAt ?? nowIso,
      closedAt: parsed.closedAt ?? nowIso,
      totals: parsed.totals ?? {},
    };
  }

  async healthCheck(): Promise<{
    ok: boolean;
    details?: Record<string, unknown>;
  }> {
    // The cloud half is healthy whenever it can reach the DB to enqueue.
    // Real ÖKC reachability is a per-device `status()` concern.
    try {
      await this.prisma.fiscalDeviceRecord.count({
        where: { providerId: this.id },
      });
      return {
        ok: true,
        details: { provider: this.id, vendorProfile: this.vendorProfile },
      };
    } catch (e) {
      return { ok: false, details: { error: (e as Error).message } };
    }
  }
}
