import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { CreditService } from "./credit.service";

/**
 * Credits are the only place in the product where a single request costs real
 * vendor money (a Meshy 3D model is ~₺12, a video ~$0.42). Every test here is
 * about not spending money the customer has not paid for, or charging them for
 * work that never happened.
 */
describe("CreditService", () => {
  let prisma: MockPrismaClient;
  let svc: CreditService;

  const TENANT = "t-1";

  /** granted / used, as the two aggregate calls claim() makes. */
  function stubBalance(granted: number, used: number) {
    (prisma.creditLot.aggregate as any).mockResolvedValue({
      _sum: { units: granted },
    });
    (prisma.creditLedger.aggregate as any).mockResolvedValue({
      _sum: { units: used },
    });
  }

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new CreditService(prisma as any);
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn(prisma),
    );
    (prisma.$queryRaw as any).mockResolvedValue([]);
    (prisma.creditLot.findFirst as any).mockResolvedValue({ id: "lot-1" });
    (prisma.creditLedger.create as any).mockResolvedValue({ id: "led-1" });
  });

  describe("balance", () => {
    it("is granted minus used, for all time", async () => {
      // No calendar window: credits bought in March are still there in
      // December. That is the whole difference from the monthly quota this
      // replaced.
      stubBalance(100, 40);
      expect(await svc.balance(TENANT, "PHOTO")).toBe(60);
    });

    it("is zero for a tenant who has bought nothing", async () => {
      (prisma.creditLot.aggregate as any).mockResolvedValue({
        _sum: { units: null },
      });
      (prisma.creditLedger.aggregate as any).mockResolvedValue({
        _sum: { units: null },
      });
      expect(await svc.balance(TENANT, "PHOTO")).toBe(0);
    });
  });

  describe("claim", () => {
    it("takes a per-tenant-per-kind advisory lock BEFORE reading the balance", async () => {
      // Without the lock, N parallel generations each read the same balance,
      // each find it sufficient, and the tenant gets generations nobody paid
      // for. The lock is transaction-scoped so it cannot leak on a pooled
      // connection.
      stubBalance(100, 0);
      await svc.claim(TENANT, "PHOTO", 1);

      expect(prisma.$queryRaw).toHaveBeenCalled();
      const sql = (prisma.$queryRaw as any).mock.calls[0][0].join("");
      expect(sql).toContain("pg_advisory_xact_lock");
    });

    it("writes a consumption row and returns its id", async () => {
      stubBalance(100, 40);
      const id = await svc.claim(TENANT, "PHOTO", 3, {
        type: "media_job",
        id: "job-9",
      });

      expect(id).toBe("led-1");
      expect((prisma.creditLedger.create as any).mock.calls[0][0].data)
        .toMatchObject({
          tenantId: TENANT,
          kind: "PHOTO",
          units: 3,
          lotId: "lot-1",
          refType: "media_job",
          refId: "job-9",
        });
    });

    it("attributes the draw to the OLDEST lot (FIFO)", async () => {
      stubBalance(100, 0);
      await svc.claim(TENANT, "PHOTO", 1);
      expect((prisma.creditLot.findFirst as any).mock.calls[0][0]).toMatchObject(
        { orderBy: { createdAt: "asc" } },
      );
    });

    it("refuses a claim larger than the balance, whole", async () => {
      // Partial spends would leave the customer charged for a generation that
      // could not complete.
      stubBalance(10, 8);
      await expect(svc.claim(TENANT, "PHOTO", 4)).rejects.toMatchObject({
        response: expect.objectContaining({
          details: expect.objectContaining({ remaining: 2, requested: 4 }),
        }),
      });
      expect(prisma.creditLedger.create).not.toHaveBeenCalled();
    });

    it("names the pack to buy on the 402, so the client can deep-link", async () => {
      stubBalance(0, 0);
      await expect(svc.claim(TENANT, "MODEL3D", 1)).rejects.toMatchObject({
        response: expect.objectContaining({
          details: expect.objectContaining({ offerCode: "credit_ai_3d_10" }),
        }),
      });
    });

    it("does not count refunded consumption against the balance", async () => {
      // A failed generation must never cost the customer anything: the
      // aggregate is scoped to voided:false on both sides.
      stubBalance(100, 40);
      await svc.claim(TENANT, "PHOTO", 1);
      const ledgerWhere = (prisma.creditLedger.aggregate as any).mock
        .calls[0][0].where;
      const lotWhere = (prisma.creditLot.aggregate as any).mock.calls[0][0]
        .where;
      expect(ledgerWhere.voided).toBe(false);
      expect(lotWhere.voided).toBe(false);
    });

    it("keeps each kind in its own pool", async () => {
      stubBalance(100, 0);
      await svc.claim(TENANT, "MODEL3D", 1);
      expect(
        (prisma.creditLot.aggregate as any).mock.calls[0][0].where.kind,
      ).toBe("MODEL3D");
    });
  });

  describe("refunds", () => {
    it("void is idempotent — only an unvoided row is touched", async () => {
      (prisma.creditLedger.updateMany as any).mockResolvedValue({ count: 1 });
      await svc.void("led-1");
      expect((prisma.creditLedger.updateMany as any).mock.calls[0][0]).toEqual({
        where: { id: "led-1", voided: false },
        data: { voided: true },
      });
    });

    it("voidByRef refunds the claim behind a failed job", async () => {
      (prisma.creditLedger.updateMany as any).mockResolvedValue({ count: 1 });
      await svc.voidByRef("job-9");
      expect((prisma.creditLedger.updateMany as any).mock.calls[0][0].where)
        .toEqual({ refId: "job-9", voided: false });
    });

    it("sweeps claims that never became work, with an hour of grace", async () => {
      // A hard kill between claim() and the job insert strands a row that
      // neither void() (process died) nor voidByRef() (no ref) can reach.
      // Live claims attach within seconds, so an hour cannot race a real one.
      (prisma.creditLedger.updateMany as any).mockResolvedValue({ count: 2 });
      await svc.sweepOrphanClaims();

      const where = (prisma.creditLedger.updateMany as any).mock.calls[0][0]
        .where;
      expect(where.voided).toBe(false);
      expect(where.refId).toBeNull();
      expect(where.createdAt.lt.getTime()).toBeLessThanOrEqual(
        Date.now() - 60 * 60 * 1000,
      );
    });
  });

  describe("operator grant", () => {
    it("mints a lot at zero price with an auditable source", async () => {
      (prisma.creditLot.create as any).mockResolvedValue({ id: "lot-x" });
      await svc.grant(TENANT, "SMS", 500, "admin-7");
      expect((prisma.creditLot.create as any).mock.calls[0][0].data)
        .toMatchObject({
          tenantId: TENANT,
          kind: "SMS",
          units: 500,
          source: "comp:admin:admin-7",
          priceCents: 0,
        });
    });
  });
});
