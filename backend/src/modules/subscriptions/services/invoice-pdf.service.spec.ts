import { NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { InvoicePdfService } from './invoice-pdf.service';

/**
 * Iter-96 regression for InvoicePdfService.
 *
 * Pre-fix `generateInvoicePdf(invoiceId, tenantId?: string)` typed
 * tenantId as optional and only ran the cross-tenant IDOR check inside
 * `if (tenantId && ...)`. The type-system loophole let a future caller
 * (cron, internal job, settlement webhook) accidentally omit tenantId
 * and write a PDF + update `pdfUrl` for an arbitrary invoice. The
 * follow-up `invoice.update({ where: { id }, data: { pdfUrl } })` was
 * also not tenant-scoped — defence-in-depth missing.
 *
 * Iter-96 makes tenantId required (type-system enforced), drops the
 * gated branch, and tenant-scopes the pdfUrl write via updateMany on
 * `subscription: { tenantId }`.
 */
describe('InvoicePdfService.generateInvoicePdf (iter-96)', () => {
  let prisma: any;
  let svc: InvoicePdfService;
  let storageDir: string;
  let originalCwd: string;

  beforeAll(() => {
    // Service uses process.cwd()/storage/invoices. Redirect to a tmp
    // dir so the test doesn't dump real PDFs into the repo.
    originalCwd = process.cwd();
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-pdf-spec-'));
    process.chdir(storageDir);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    prisma = {
      invoice: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    svc = new InvoicePdfService(prisma);
  });

  function mockInvoice(tenantId: string) {
    return {
      id: 'inv-1',
      invoiceNumber: 'INV-202604-0001-abcdef',
      currency: 'TRY',
      subtotal: 100,
      tax: 20,
      total: 120,
      status: 'PAID',
      periodStart: new Date('2026-04-01'),
      periodEnd: new Date('2026-04-30'),
      dueDate: new Date('2026-04-15'),
      paidAt: new Date('2026-04-10'),
      createdAt: new Date('2026-04-01'),
      taxIdSnapshot: '1234567890',
      payment: null,
      subscription: {
        tenantId,
        billingCycle: 'MONTHLY',
        plan: { displayName: 'Pro' },
        tenant: { name: 'TestCo', subdomain: 'testco', taxId: '1234567890' },
      },
    };
  }

  it('refuses when the invoice belongs to a different tenant (the IDOR guard)', async () => {
    prisma.invoice.findUnique.mockResolvedValue(mockInvoice('t-owner'));
    await expect(svc.generateInvoicePdf('inv-1', 't-attacker')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // No write should have happened.
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when the invoice does not exist (probing-resistant 404)', async () => {
    prisma.invoice.findUnique.mockResolvedValue(null);
    await expect(svc.generateInvoicePdf('inv-missing', 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('writes the pdfUrl using a tenant-scoped updateMany (defence in depth)', async () => {
    prisma.invoice.findUnique.mockResolvedValue(mockInvoice('t1'));
    const filename = await svc.generateInvoicePdf('inv-1', 't1');
    expect(filename).toBe('invoice-INV-202604-0001-abcdef.pdf');

    // Critical: updateMany WHERE includes the subscription.tenantId
    // predicate. Pre-iter-96 the write was `update({ where: { id } })`
    // with no tenant scope.
    const call = prisma.invoice.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({
      id: 'inv-1',
      subscription: { tenantId: 't1' },
    });
    expect(call.data).toEqual({ pdfUrl: 'invoice-INV-202604-0001-abcdef.pdf' });
  });

  it('throws NotFound if the updateMany matches zero rows (e.g. invoice deleted mid-flight)', async () => {
    prisma.invoice.findUnique.mockResolvedValue(mockInvoice('t1'));
    prisma.invoice.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.generateInvoicePdf('inv-1', 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
