import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  FiscalCapability,
  FiscalDeviceStatus,
  FiscalProvider,
  FiscalReceiptRequest,
  FiscalReceiptResult,
  ZReport,
} from "../fiscal-provider.interface";
import { FiscalProviderRegistry } from "../fiscal-provider.registry";
import { PrismaService } from "../../../prisma/prisma.service";

/**
 * e-Fatura / e-Arşiv adapter — HONESTY SHIM (does NOT issue e-documents).
 *
 * IMPORTANT: this provider does NOT submit anything to the GİB and MUST NOT
 * claim it does. The genuine e-Fatura/e-Arşiv rail lives entirely in the
 * accounting module and fires automatically on order payment:
 *
 *   PaymentFinalizer.maybeGenerateAutoInvoice (on order PAID)
 *     → SalesInvoiceService.createFromOrder / createFromPayment
 *       → AccountingSyncService.syncInvoice  (real Parasut/Foriba/Logo HTTP)
 *
 * That path is gated on the tenant's Settings → Accounting configuration
 * (provider !== "NONE", autoSync/autoGenerateInvoice) and is the ONLY thing
 * that produces a legally-valid e-document.
 *
 * Historically this adapter FAKED an issuance: it minted a local `EARS-…`
 * fiscalNo, wrote a bare `SalesInvoice{status:'pending'}` row that the
 * accounting batch never picks up (it only syncs ISSUED invoices it created
 * itself), and returned `status:'issued'` — so the FiscalReceipt was marked
 * issued while NOTHING was ever submitted to the GİB, and a duplicate,
 * orphaned invoice row diverged the ledger. That is a fiscal-compliance
 * landmine and has been removed.
 *
 * The adapter stays registered (so a tenant who created an `efatura`
 * FiscalDeviceRecord by mistake gets a clear, actionable error instead of a
 * silent fake), but `issueReceipt` now returns `status:'failed'` with a
 * message pointing the operator at the real rail. The physical-yazarkasa
 * providers (Hugin/Beko via GMP-3) remain the real `FiscalProvider`
 * issuance path; e-documents go through Accounting.
 */
@Injectable()
export class EfaturaFiscalProvider implements FiscalProvider, OnModuleInit {
  readonly id = "efatura";
  readonly capabilities: FiscalCapability[] = ["invoice"];
  private readonly logger = new Logger(EfaturaFiscalProvider.name);

  constructor(
    private readonly registry: FiscalProviderRegistry,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async issueReceipt(req: FiscalReceiptRequest): Promise<FiscalReceiptResult> {
    // HONEST: never fake an e-document issuance. We do NOT mint a fiscalNo,
    // do NOT write a SalesInvoice row (that would orphan-diverge the ledger),
    // and do NOT return 'issued'. e-Fatura/e-Arşiv are issued by the
    // Accounting integration on order payment, not by this fiscal provider.
    const message =
      "e-Fatura / e-Arşiv is not issued through the fiscal provider. " +
      "It is generated automatically on order payment by the Accounting " +
      "integration (Settings → Accounting → choose a provider and enable " +
      "auto-invoice). This 'efatura' fiscal device cannot print an e-document.";
    this.logger.warn(
      `efatura.issueReceipt called for order=${req.orderId ?? "-"} ` +
        `tenant=${req.tenantId}; refusing to fake an issuance. ${message}`,
    );
    return {
      providerId: this.id,
      receiptId: req.idempotencyKey,
      status: "failed",
      error: message,
    };
  }

  async cancelReceipt(_id: string, _reason: string): Promise<void> {
    // e-Arşiv cancellation is a GİB-side operation; the accounting batch
    // handles it. No-op here for the MVP shim.
  }

  async reprintReceipt(_id: string): Promise<void> {
    // PDFs are generated on demand by the existing invoice-pdf service.
  }

  async status(fiscalDeviceId: string): Promise<FiscalDeviceStatus> {
    return { providerId: this.id, fiscalDeviceId, status: "online" };
  }

  async zReport(_fiscalDeviceId: string, _date: Date): Promise<ZReport> {
    // e-Arşiv has no Z report; return an empty placeholder so callers that
    // ask uniformly don't blow up.
    return {
      providerId: this.id,
      fiscalDeviceId: _fiscalDeviceId,
      zNo: "",
      openedAt: new Date().toISOString(),
      closedAt: new Date().toISOString(),
      totals: {},
    };
  }

  async closeDay(fiscalDeviceId: string): Promise<ZReport> {
    return this.zReport(fiscalDeviceId, new Date());
  }

  async healthCheck() {
    return { ok: true };
  }
}
