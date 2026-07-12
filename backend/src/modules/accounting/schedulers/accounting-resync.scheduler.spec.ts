import { AccountingResyncScheduler } from "./accounting-resync.scheduler";

/**
 * A6 — the hourly recovery sweep must discover tenants with FAILED
 * invoices AND tenants whose only broken rows are crash-stuck SYNCING ones
 * (updatedAt older than the 15-minute threshold). Pre-fix the tenant query
 * matched FAILED only, so a tenant whose worker died mid-sync never even
 * entered the sweep and its invoice stayed SYNCING forever.
 */
describe("AccountingResyncScheduler.resyncFailed", () => {
  function build(tenants: Array<{ tenantId: string }>) {
    const prisma: any = {
      salesInvoice: { findMany: jest.fn().mockResolvedValue(tenants) },
    };
    const sync: any = { resyncFailedInvoices: jest.fn().mockResolvedValue(1) };
    const scheduler = new AccountingResyncScheduler(prisma, sync);
    return { prisma, sync, scheduler };
  }

  it("discovers tenants via FAILED OR stale-SYNCING (15min threshold), distinct + bounded", async () => {
    const { prisma, scheduler } = build([]);

    const before = Date.now();
    await scheduler.resyncFailed();
    const after = Date.now();

    const args = prisma.salesInvoice.findMany.mock.calls[0][0];
    expect(args.distinct).toEqual(["tenantId"]);
    expect(args.take).toBe(500);

    const or = args.where.OR;
    expect(or).toHaveLength(2);
    expect(or[0]).toEqual({ externalStatus: "FAILED" });
    expect(or[1].externalStatus).toBe("SYNCING");
    const cutoff = or[1].updatedAt.lt as Date;
    expect(cutoff).toBeInstanceOf(Date);
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 15 * 60 * 1000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - 15 * 60 * 1000);
  });

  it("retries each discovered tenant's batch independently", async () => {
    const { sync, scheduler } = build([
      { tenantId: "t1" },
      { tenantId: "t2" },
    ]);
    sync.resyncFailedInvoices
      .mockRejectedValueOnce(new Error("tenant boom"))
      .mockResolvedValueOnce(3);

    await scheduler.resyncFailed(); // must not throw

    expect(sync.resyncFailedInvoices).toHaveBeenCalledTimes(2);
    expect(sync.resyncFailedInvoices).toHaveBeenCalledWith("t1");
    expect(sync.resyncFailedInvoices).toHaveBeenCalledWith("t2");
  });
});
