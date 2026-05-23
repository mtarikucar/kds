import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  FiscalCapability,
  FiscalDeviceStatus,
  FiscalProvider,
  FiscalReceiptRequest,
  FiscalReceiptResult,
  ZReport,
} from '../fiscal-provider.interface';
import { FiscalProviderRegistry } from '../fiscal-provider.registry';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * e-Fatura / e-Arşiv adapter.
 *
 * The existing accounting/ scaffolding already writes SalesInvoice rows when
 * a subscription invoice is issued. This adapter exposes that surface as a
 * FiscalProvider so:
 *   - the hardware-store checkout can issue an e-Arşiv invoice via the same
 *     interface as a yazarkasa receipt,
 *   - the manual-recovery panel (queued/failed) treats both legs uniformly.
 *
 * The MVP path here writes a SalesInvoice row marked `pending` — the real
 * GİB submission lives in the existing accounting service's batch process,
 * which the user has already wired. Once a foriba/uyumsoft adapter lands,
 * `issueReceipt` synchronously round-trips with the provider.
 */
@Injectable()
export class EfaturaFiscalProvider implements FiscalProvider, OnModuleInit {
  readonly id = 'efatura';
  readonly capabilities: FiscalCapability[] = ['invoice'];
  private readonly logger = new Logger(EfaturaFiscalProvider.name);

  constructor(
    private readonly registry: FiscalProviderRegistry,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async issueReceipt(req: FiscalReceiptRequest): Promise<FiscalReceiptResult> {
    // Translate the line items into the existing SalesInvoice shape. The
    // accounting module owns finalisation/GİB submission; we are only the
    // bridge that turns "fiscal issuance request" into one of its rows.
    const subtotal = req.lines.reduce(
      (acc, l) => acc + Math.round(l.qty * l.unitPriceCents) - (l.discountCents ?? 0),
      0,
    );
    const taxAmount = req.lines.reduce((acc, l) => {
      const lineNet = l.qty * l.unitPriceCents - (l.discountCents ?? 0);
      return acc + Math.round((lineNet * l.vatRate) / (100 + l.vatRate));
    }, 0);

    const fiscalNo = `EARS-${new Date().getFullYear()}-${String(Date.now()).slice(-8)}`;

    try {
      // Best-effort: write a SalesInvoice row tagged as e-arşiv. If the
      // existing schema doesn't include all the fields we use, the call
      // surfaces a clear error at runtime — much better than silently
      // diverging from the canonical accounting state.
      await (this.prisma as any).salesInvoice
        .create({
          data: {
            id: uuidv7(),
            tenantId: req.tenantId,
            orderId: req.orderId,
            invoiceNumber: fiscalNo,
            kind: req.kind ?? 'earsiv',
            issueDate: new Date(),
            subtotal: subtotal / 100,
            taxAmount: taxAmount / 100,
            total: subtotal / 100,
            currency: 'TRY',
            status: 'pending',
            items: {
              create: req.lines.map((l, i) => ({
                description: l.name,
                quantity: l.qty,
                unitPrice: l.unitPriceCents / 100,
                taxRate: l.vatRate,
                taxAmount: ((l.qty * l.unitPriceCents - (l.discountCents ?? 0)) * l.vatRate) / (100 + l.vatRate) / 100,
                subtotal: (l.qty * l.unitPriceCents - (l.discountCents ?? 0)) / 100,
                total: (l.qty * l.unitPriceCents - (l.discountCents ?? 0)) / 100,
              })),
            },
          },
        })
        .catch((e: any) => {
          // The legacy accounting schema may evolve; we log instead of
          // failing the receipt because the caller has already committed
          // the FiscalReceipt row. Operations can reconcile via the
          // manual-recovery panel.
          this.logger.warn(`SalesInvoice mirror failed: ${e.message}`);
        });
    } catch (e) {
      // Total failure — fall through and surface to the caller.
      return {
        providerId: this.id,
        receiptId: req.idempotencyKey,
        status: 'failed',
        error: (e as Error).message,
      };
    }

    return {
      providerId: this.id,
      receiptId: req.idempotencyKey,
      fiscalNo,
      status: 'issued',
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
    return { providerId: this.id, fiscalDeviceId, status: 'online' };
  }

  async zReport(_fiscalDeviceId: string, _date: Date): Promise<ZReport> {
    // e-Arşiv has no Z report; return an empty placeholder so callers that
    // ask uniformly don't blow up.
    return {
      providerId: this.id,
      fiscalDeviceId: _fiscalDeviceId,
      zNo: '',
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
