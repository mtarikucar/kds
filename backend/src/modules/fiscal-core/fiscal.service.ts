import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { FiscalProviderRegistry } from './fiscal-provider.registry';
import { FiscalReceiptRequest } from './fiscal-provider.interface';

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
  ) {}

  async issueReceipt(req: FiscalReceiptRequest) {
    // Compound WHERE — same defense-in-depth pattern as iter-35
    // device-mesh findOrThrow. Fiscal records are TR-law-mandated
    // financial data; an id-only lookup that returns the row to a
    // later step (status check, provider dispatch) is too brittle.
    const device = await this.prisma.fiscalDeviceRecord.findFirst({
      where: { id: req.fiscalDeviceId, tenantId: req.tenantId },
    });
    if (!device) {
      throw new NotFoundException('Fiscal device not found');
    }
    if (device.status === 'retired') throw new BadRequestException('Fiscal device retired');

    // Idempotency check.
    const existing = await this.prisma.fiscalReceipt.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: req.tenantId, idempotencyKey: req.idempotencyKey } },
    });
    if (existing) return existing;

    const totalCents = req.lines.reduce(
      (acc, l) => acc + Math.round(l.qty * l.unitPriceCents) - (l.discountCents ?? 0),
      0,
    );
    const vatBreakdown: Record<string, number> = {};
    for (const l of req.lines) {
      const vat = Math.round(
        ((l.qty * l.unitPriceCents - (l.discountCents ?? 0)) * l.vatRate) / (100 + l.vatRate),
      );
      const k = String(l.vatRate);
      vatBreakdown[k] = (vatBreakdown[k] ?? 0) + vat;
    }

    // Persist queued row.
    const row = await this.prisma.fiscalReceipt.create({
      data: {
        id: uuidv7(),
        tenantId: req.tenantId,
        orderId: req.orderId,
        fiscalDeviceId: req.fiscalDeviceId,
        providerId: device.providerId,
        totalCents,
        vatBreakdown: vatBreakdown as any,
        idempotencyKey: req.idempotencyKey,
        status: 'queued',
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
      const updated = await this.prisma.fiscalReceipt.update({
        where: { id: row.id },
        data: {
          status: result.status === 'issued' ? 'issued' : 'failed',
          fiscalNo: result.fiscalNo,
          fiscalZNo: result.fiscalZNo,
          issuedAt: result.status === 'issued' ? new Date() : null,
          lastError: result.status !== 'issued' ? result.error : null,
        },
      });
      await this.outbox
        .append({
          type: result.status === 'issued' ? 'fiscal.receipt.printed.v1' : 'fiscal.receipt.failed.v1',
          tenantId: req.tenantId,
          payload: {
            fiscalReceiptId: updated.id,
            fiscalDeviceId: req.fiscalDeviceId,
            fiscalNo: result.fiscalNo,
            error: result.error,
          },
        })
        .catch(() => undefined);
      return updated;
    } catch (e) {
      const updated = await this.prisma.fiscalReceipt.update({
        where: { id: row.id },
        data: { status: 'failed', lastError: (e as Error).message, attempts: { increment: 1 } },
      });
      await this.outbox
        .append({
          type: 'fiscal.receipt.failed.v1',
          tenantId: req.tenantId,
          payload: { fiscalReceiptId: updated.id, error: (e as Error).message },
        })
        .catch(() => undefined);
      return updated;
    }
  }

  async cancelReceipt(tenantId: string, fiscalReceiptId: string, reason: string) {
    const row = await this.prisma.fiscalReceipt.findFirst({
      where: { id: fiscalReceiptId, tenantId },
    });
    if (!row) throw new NotFoundException('Receipt not found');
    if (row.status !== 'issued') throw new BadRequestException('Only issued receipts can be cancelled');
    const provider = this.registry.get(row.providerId);
    await provider.cancelReceipt(fiscalReceiptId, reason);
    return this.prisma.fiscalReceipt.update({
      where: { id: row.id },
      data: { status: 'cancelled', lastError: `cancelled: ${reason}` },
    });
  }

  async closeDay(tenantId: string, fiscalDeviceId: string) {
    const device = await this.prisma.fiscalDeviceRecord.findFirst({
      where: { id: fiscalDeviceId, tenantId },
    });
    if (!device) throw new NotFoundException('Fiscal device not found');
    // Mirror issueReceipt's retired-device gate. A retired yazarkasa
    // can't legally produce a Z report (the unit is decommissioned and
    // its counters frozen at the time of retirement), so the operator
    // probably wanted to close the day on a DIFFERENT device. Surface
    // that with a clean 400 rather than letting it fail mid-adapter.
    if (device.status === 'retired') {
      throw new BadRequestException('Fiscal device retired — cannot close day');
    }
    const provider = this.registry.get(device.providerId);
    const report = await provider.closeDay(fiscalDeviceId);
    await this.prisma.fiscalDayClose.create({
      data: {
        id: uuidv7(),
        tenantId,
        fiscalDeviceId,
        zNo: report.zNo,
        openedAt: new Date(report.openedAt),
        closedAt: new Date(report.closedAt),
        totals: report.totals as any,
      },
    });
    await this.outbox
      .append({
        type: 'fiscal.day.closed.v1',
        tenantId,
        payload: { fiscalDeviceId, zNo: report.zNo },
      })
      .catch(() => undefined);
    return report;
  }

  /** List receipts in queued/failed state — for the manual recovery panel. */
  async listPending(tenantId: string, limit = 100) {
    return this.prisma.fiscalReceipt.findMany({
      where: { tenantId, status: { in: ['queued', 'failed'] } },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
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

  async retryFailed(tenantId: string, fiscalReceiptId: string) {
    const row = await this.prisma.fiscalReceipt.findFirst({
      where: { id: fiscalReceiptId, tenantId },
      include: { lines: true, fiscalDevice: true },
    });
    if (!row) throw new NotFoundException('Receipt not found');
    if (row.status === 'issued') return row;   // already succeeded
    if (row.status === 'cancelled') {
      throw new BadRequestException('Cannot retry a cancelled receipt');
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
        tenantId,
        fiscalDeviceId: row.fiscalDeviceId,
        orderId: row.orderId ?? undefined,
        idempotencyKey: row.idempotencyKey,   // SAME key — provider dedupes
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
        payments: [{ method: 'cash', amountCents: row.totalCents }],
      });

      const updated = await this.prisma.fiscalReceipt.update({
        where: { id: row.id },
        data: {
          status: result.status === 'issued' ? 'issued' : 'failed',
          fiscalNo: result.fiscalNo,
          fiscalZNo: result.fiscalZNo,
          issuedAt: result.status === 'issued' ? new Date() : null,
          lastError: result.status !== 'issued' ? result.error : null,
          attempts: { increment: 1 },
        },
      });

      await this.outbox
        .append({
          type: result.status === 'issued' ? 'fiscal.receipt.printed.v1' : 'fiscal.receipt.failed.v1',
          tenantId,
          payload: {
            fiscalReceiptId: updated.id,
            fiscalDeviceId: row.fiscalDeviceId,
            fiscalNo: result.fiscalNo,
            error: result.error,
            retried: true,
          },
        })
        .catch(() => undefined);

      return updated;
    } catch (e) {
      const updated = await this.prisma.fiscalReceipt.update({
        where: { id: row.id },
        data: {
          status: 'failed',
          lastError: (e as Error).message,
          attempts: { increment: 1 },
        },
      });
      this.logger.warn(`Retry failed for receipt=${row.id}: ${(e as Error).message}`);
      return updated;
    }
  }
}
