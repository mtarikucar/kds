import {
  isSubdomainQuarantined,
  reserveSubdomain,
  randomSubdomainSuffix,
} from "./subdomain.helper";
import { SUBDOMAIN_QUARANTINE_DAYS } from "../constants/subdomain.const";

/**
 * Long-tail spec for subdomain quarantine/reservation helpers (subdomain
 * takeover defence). Load-bearing contracts: a reserved platform name is
 * blocked without a DB hit; a parked subdomain inside its availableAfter
 * window is blocked while an expired one is free; reserveSubdomain upserts
 * with an availableAfter ~quarantine days out; suffix is 6 hex chars.
 */
describe("subdomain.helper", () => {
  describe("isSubdomainQuarantined", () => {
    it("blocks a hard-coded reserved subdomain without querying the DB", async () => {
      const prisma = {
        reservedSubdomain: { findUnique: jest.fn() },
      } as any;
      expect(await isSubdomainQuarantined(prisma, "API")).toBe(true);
      expect(prisma.reservedSubdomain.findUnique).not.toHaveBeenCalled();
    });

    it("blocks a parked subdomain still inside its quarantine window", async () => {
      const future = new Date(Date.now() + 86_400_000);
      const prisma = {
        reservedSubdomain: {
          findUnique: jest.fn().mockResolvedValue({ availableAfter: future }),
        },
      } as any;
      expect(await isSubdomainQuarantined(prisma, "burgerking")).toBe(true);
    });

    it("frees a subdomain whose quarantine window has elapsed", async () => {
      const past = new Date(Date.now() - 86_400_000);
      const prisma = {
        reservedSubdomain: {
          findUnique: jest.fn().mockResolvedValue({ availableAfter: past }),
        },
      } as any;
      expect(await isSubdomainQuarantined(prisma, "burgerking")).toBe(false);
    });

    it("frees a subdomain with no reservation record", async () => {
      const prisma = {
        reservedSubdomain: { findUnique: jest.fn().mockResolvedValue(null) },
      } as any;
      expect(await isSubdomainQuarantined(prisma, "freename")).toBe(false);
    });

    // Own-name reclaim: the quarantine blocks OTHER tenants from taking over
    // a released name — the releasing tenant undoing its own rename must not
    // be locked out of its previous (printed-QR) address for 90 days.
    it("treats a quarantine row owned by the SAME tenant as reclaimable", async () => {
      const future = new Date(Date.now() + 86_400_000);
      const prisma = {
        reservedSubdomain: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ availableAfter: future, tenantId: "t-1" }),
        },
      } as any;
      expect(await isSubdomainQuarantined(prisma, "myoldname", "t-1")).toBe(
        false,
      );
    });

    it("still blocks a quarantine row owned by ANOTHER tenant", async () => {
      const future = new Date(Date.now() + 86_400_000);
      const prisma = {
        reservedSubdomain: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ availableAfter: future, tenantId: "t-other" }),
        },
      } as any;
      expect(await isSubdomainQuarantined(prisma, "someones", "t-1")).toBe(
        true,
      );
    });

    it("still blocks an owner-less (legacy) quarantine row even with a requesting tenant", async () => {
      const future = new Date(Date.now() + 86_400_000);
      const prisma = {
        reservedSubdomain: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ availableAfter: future, tenantId: null }),
        },
      } as any;
      expect(await isSubdomainQuarantined(prisma, "legacy", "t-1")).toBe(true);
    });

    it("still blocks a platform-reserved name regardless of requesting tenant", async () => {
      const prisma = {
        reservedSubdomain: { findUnique: jest.fn() },
      } as any;
      expect(await isSubdomainQuarantined(prisma, "admin", "t-1")).toBe(true);
      expect(prisma.reservedSubdomain.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("reserveSubdomain", () => {
    it("upserts a lowercased subdomain with availableAfter ~quarantine days out", async () => {
      const upsert = jest.fn().mockResolvedValue(undefined);
      const prisma = { reservedSubdomain: { upsert } } as any;
      const before = Date.now();
      await reserveSubdomain(prisma, "MyName", "tenant_deleted");
      const arg = upsert.mock.calls[0][0];
      expect(arg.where.subdomain).toBe("myname");
      expect(arg.create.reason).toBe("tenant_deleted");
      const delta = arg.create.availableAfter.getTime() - before;
      const expected = SUBDOMAIN_QUARANTINE_DAYS * 86_400_000;
      // within a day of the expected quarantine length
      expect(Math.abs(delta - expected)).toBeLessThan(86_400_000);
      // No owner supplied → explicit null stamp (blocks everyone).
      expect(arg.create.tenantId).toBeNull();
      expect(arg.update.tenantId).toBeNull();
    });

    it("stamps the releasing tenant on both the create and update branches", async () => {
      const upsert = jest.fn().mockResolvedValue(undefined);
      const prisma = { reservedSubdomain: { upsert } } as any;
      await reserveSubdomain(prisma, "MyName", "subdomain_changed", "t-1");
      const arg = upsert.mock.calls[0][0];
      expect(arg.create.tenantId).toBe("t-1");
      expect(arg.update.tenantId).toBe("t-1");
    });
  });

  describe("randomSubdomainSuffix", () => {
    it("returns a 6-char lowercase hex string", () => {
      const s = randomSubdomainSuffix();
      expect(s).toMatch(/^[0-9a-f]{6}$/);
    });

    it("is non-deterministic across calls", () => {
      expect(randomSubdomainSuffix()).not.toBe(randomSubdomainSuffix());
    });
  });
});
