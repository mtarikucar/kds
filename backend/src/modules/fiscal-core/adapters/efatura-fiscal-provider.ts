import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
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

    // Invoice numbers were previously `EARS-${year}-${Date.now().slice(-8)}`.
    // Two issuances in the same millisecond produced an identical number,
    // hit the salesInvoice.invoiceNumber unique constraint with P2002, and
    // dumped the receipt into manual-recovery — for no real reason. Append
    // a 4-byte random suffix so concurrent issuances stay unique by design.
    // Format stays grep-friendly: EARS-YYYY-<8-digit-time>-<8-hex-rand>.
    const fiscalNo = `EARS-${new Date().getFullYear()}-${String(Date.now()).slice(-8)}-${randomBytes(4).toString('hex')}`;

    // Write the SalesInvoice mirror row. Failure here used to be swallowed
    // ("best-effort log and continue"), which left the fiscal receipt
    // marked 'issued' while accounting had no record — an auditable
    // divergence. Now we fail the FiscalReceiptResult on any write error
    // so the caller marks the receipt 'failed' and the ops manual-recovery
    // panel picks it up.
    try {
      await (this.prisma as any).salesInvoice.create({
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
            create: req.lines.map((l) => ({
              description: l.name,
              quantity: l.qty,
              unitPrice: l.unitPriceCents / 100,
              taxRate: l.vatRate,
              taxAmount:
                ((l.qty * l.unitPriceCents - (l.discountCents ?? 0)) * l.vatRate) /
                (100 + l.vatRate) /
                100,
              subtotal: (l.qty * l.unitPriceCents - (l.discountCents ?? 0)) / 100,
              total: (l.qty * l.unitPriceCents - (l.discountCents ?? 0)) / 100,
            })),
          },
        },
      });
    } catch (e) {
      this.logger.warn(`SalesInvoice mirror failed for receipt ${req.idempotencyKey}: ${(e as Error).message}`);
      return {
        providerId: this.id,
        receiptId: req.idempotencyKey,
        status: 'failed',
        error: `SalesInvoice mirror failed: ${(e as Error).message}`,
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
