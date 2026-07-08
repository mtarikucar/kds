import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PurchaseInvoicesService } from './purchase-invoices.service';

/**
 * AP vendor bills + 3-way match. Ordered (Σ qtyOrdered×price) ↔ received/GRN
 * (Σ qtyReceived×price) ↔ invoiced (bill total). Within tolerance → MATCHED,
 * else DISCREPANCY. Bills dedupe per (supplier, invoiceNumber).
 */
describe('PurchaseInvoicesService', () => {
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;
  let prisma: any;
  let svc: PurchaseInvoicesService;

  beforeEach(() => {
    prisma = {
      purchaseInvoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'inv-1', ...data })),
      },
      purchaseOrder: { findFirst: jest.fn() },
    };
    svc = new PurchaseInvoicesService(prisma);
  });

  const poWith = (items: any[]) => ({ id: 'po-1', items });

  it('marks an invoice MATCHED when its total equals the received (GRN) total', async () => {
    // received = 10×5 = 50; invoice subtotal 50 + tax 0 = 50 → matched
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      poWith([{ quantityOrdered: 10, quantityReceived: 10, unitPrice: 5 }]),
    );
    const inv = await svc.create(SCOPE, 'u1', {
      supplierId: 'S1', purchaseOrderId: 'po-1', invoiceNumber: 'F-1',
      invoiceDate: '2026-06-01', subtotal: 50, taxAmount: 0,
    });
    expect(inv.status).toBe('MATCHED');
    expect(Number(inv.matchVariance)).toBe(0);
    expect(Number(inv.total)).toBe(50);
  });

  it('flags DISCREPANCY when the invoice total exceeds received beyond tolerance', async () => {
    // received = 10×5 = 50; invoice total 70 → variance 20 > tolerance → discrepancy
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      poWith([{ quantityOrdered: 10, quantityReceived: 10, unitPrice: 5 }]),
    );
    const inv = await svc.create(SCOPE, 'u1', {
      supplierId: 'S1', purchaseOrderId: 'po-1', invoiceNumber: 'F-2',
      invoiceDate: '2026-06-01', subtotal: 70, taxAmount: 0,
    });
    expect(inv.status).toBe('DISCREPANCY');
    expect(Number(inv.matchVariance)).toBe(20);
  });

  it('leaves an unlinked invoice as RECEIVED (no PO to match)', async () => {
    const inv = await svc.create(SCOPE, 'u1', {
      supplierId: 'S1', invoiceNumber: 'F-3',
      invoiceDate: '2026-06-01', subtotal: 100, taxAmount: 20,
    });
    expect(inv.status).toBe('RECEIVED');
    expect(Number(inv.total)).toBe(120);
    expect(prisma.purchaseOrder.findFirst).not.toHaveBeenCalled();
  });

  it('dedupes a re-sent bill (same supplier + invoiceNumber)', async () => {
    prisma.purchaseInvoice.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(
      svc.create(SCOPE, 'u1', {
        supplierId: 'S1', invoiceNumber: 'F-1',
        invoiceDate: '2026-06-01', subtotal: 10, taxAmount: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseInvoice.create).not.toHaveBeenCalled();
  });

  it('tolerates a within-1% received-vs-invoice gap as MATCHED', async () => {
    // received = 1000; invoice 1005 → variance 5, tolerance = 1% of 1000 = 10 → matched
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      poWith([{ quantityOrdered: 100, quantityReceived: 100, unitPrice: 10 }]),
    );
    const inv = await svc.create(SCOPE, 'u1', {
      supplierId: 'S1', purchaseOrderId: 'po-1', invoiceNumber: 'F-4',
      invoiceDate: '2026-06-01', subtotal: 1005, taxAmount: 0,
    });
    expect(inv.status).toBe('MATCHED');
  });
});

describe('PurchaseInvoicesService.getApAging', () => {
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;
  let prisma: any;
  let svc: PurchaseInvoicesService;

  beforeEach(() => {
    prisma = { purchaseInvoice: { findMany: jest.fn() } };
    svc = new PurchaseInvoicesService(prisma);
  });

  it('buckets unpaid bills by age and totals by supplier', async () => {
    const asOf = new Date('2026-07-01T00:00:00Z');
    prisma.purchaseInvoice.findMany.mockResolvedValue([
      { id: 'i1', supplierId: 'S1', invoiceNumber: 'F1', invoiceDate: new Date('2026-06-20'), total: 100, status: 'APPROVED' }, // ~11d current
      { id: 'i2', supplierId: 'S1', invoiceNumber: 'F2', invoiceDate: new Date('2026-05-01'), total: 200, status: 'RECEIVED' }, // ~61d → 61_90
      { id: 'i3', supplierId: 'S2', invoiceNumber: 'F3', invoiceDate: new Date('2026-03-01'), total: 400, status: 'APPROVED' }, // >90d
    ]);

    const res = await svc.getApAging(SCOPE, asOf);
    expect(res.total).toBe(700);
    expect(res.buckets.current).toBe(100);
    expect(res.buckets.d61_90).toBe(200);
    expect(res.buckets.d90plus).toBe(400);
    expect(res.bySupplier[0]).toMatchObject({ supplierId: 'S2', total: 400 });
    // only unpaid queried
    expect(prisma.purchaseInvoice.findMany.mock.calls[0][0].where.status).toEqual({ not: 'PAID' });
  });
});
