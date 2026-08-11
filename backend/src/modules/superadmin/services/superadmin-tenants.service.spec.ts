import { NotFoundException } from "@nestjs/common";

// reserveSubdomain is called inside the status-flip transaction; stub it so
// we can assert it parks the subdomain only on the ACTIVE→SUSPENDED/DELETED
// edge.
jest.mock("../../../common/helpers/subdomain.helper", () => ({
  reserveSubdomain: jest.fn().mockResolvedValue(undefined),
}));

import { reserveSubdomain } from "../../../common/helpers/subdomain.helper";
import { SuperAdminTenantsService } from "./superadmin-tenants.service";
import { TenantStatus } from "../dto/tenant-filter.dto";
import { EventTypes } from "../../outbox/event-types";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

describe("SuperAdminTenantsService", () => {
  let prisma: MockPrismaClient;
  let audit: { log: jest.Mock };
  let notifications: { createAndSend: jest.Mock };
  let email: { sendPlainEmail: jest.Mock };
  let outbox: { append: jest.Mock };
  let svc: SuperAdminTenantsService;

  const ACTOR_ID = "sa-1";
  let entitlements: { getForTenant: jest.Mock };
  const ACTOR_EMAIL = "ops@platform.com";
  const TENANT_ID = "tenant-1";

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = mockPrismaClient();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    notifications = {
      createAndSend: jest.fn().mockResolvedValue(undefined),
    };
    email = { sendPlainEmail: jest.fn().mockResolvedValue(undefined) };
    outbox = { append: jest.fn().mockResolvedValue(undefined) };
    entitlements = {
      getForTenant: jest.fn().mockResolvedValue({
        features: {},
        limits: {},
        integrations: {},
        computedAt: new Date().toISOString(),
      }),
    };
    svc = new SuperAdminTenantsService(
      prisma as any,
      audit as any,
      notifications as any,
      email as any,
      outbox as any,
      entitlements as any,
    );
    // Drive $transaction(cb => ...) with the real prisma mock as the tx.
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb(prisma),
    );
  });

  describe("updateStatus", () => {
    it("throws NotFound and writes no audit when the tenant is missing", async () => {
      prisma.tenant.findUnique.mockResolvedValue(null as any);
      await expect(
        svc.updateStatus(
          TENANT_ID,
          { status: TenantStatus.SUSPENDED } as any,
          ACTOR_ID,
          ACTOR_EMAIL,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.log).not.toHaveBeenCalled();
    });

    it("is a no-op (no write, no audit) when the status is unchanged", async () => {
      prisma.tenant.findUnique
        .mockResolvedValueOnce({
          id: TENANT_ID,
          status: "ACTIVE",
          name: "Acme",
          subdomain: "acme",
        } as any)
        .mockResolvedValueOnce({ id: TENANT_ID, status: "ACTIVE" } as any);

      await svc.updateStatus(
        TENANT_ID,
        { status: TenantStatus.ACTIVE } as any,
        ACTOR_ID,
        ACTOR_EMAIL,
      );

      expect(prisma.tenant.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it("on ACTIVE→SUSPENDED: parks the subdomain, bumps tokenVersion, revokes refresh tokens, and audits SUSPEND", async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        status: "ACTIVE",
        name: "Acme",
        subdomain: "acme",
      } as any);
      prisma.tenant.update.mockResolvedValue({
        id: TENANT_ID,
        status: "SUSPENDED",
        subdomain: "acme",
      } as any);
      prisma.user.updateMany.mockResolvedValue({ count: 3 } as any);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 } as any);
      prisma.user.findMany.mockResolvedValue([] as any);

      await svc.updateStatus(
        TENANT_ID,
        { status: TenantStatus.SUSPENDED, reason: "fraud" } as any,
        ACTOR_ID,
        ACTOR_EMAIL,
      );

      // 4th arg: the owner stamp — a reactivated tenant may reclaim its own
      // parked subdomain while other tenants stay blocked.
      expect(reserveSubdomain).toHaveBeenCalledWith(
        prisma,
        "acme",
        "tenant_suspended",
        TENANT_ID,
      );
      expect(prisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { tokenVersion: { increment: 1 } },
        }),
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "SUSPEND",
          previousData: { status: "ACTIVE" },
        }),
      );
    });

    it("uses the tenant_deleted reservation reason on ACTIVE→DELETED", async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        status: "ACTIVE",
        name: "Acme",
        subdomain: "acme",
      } as any);
      prisma.tenant.update.mockResolvedValue({
        id: TENANT_ID,
        status: "DELETED",
        subdomain: "acme",
      } as any);
      prisma.user.updateMany.mockResolvedValue({ count: 0 } as any);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 } as any);
      prisma.user.findMany.mockResolvedValue([] as any);

      await svc.updateStatus(
        TENANT_ID,
        { status: TenantStatus.DELETED } as any,
        ACTOR_ID,
        ACTOR_EMAIL,
      );

      expect(reserveSubdomain).toHaveBeenCalledWith(
        prisma,
        "acme",
        "tenant_deleted",
        TENANT_ID,
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "DELETE" }),
      );
    });

    it("on SUSPENDED→ACTIVE: bumps tokenVersion (forces re-login) but does NOT reserve a subdomain", async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        status: "SUSPENDED",
        name: "Acme",
        subdomain: "acme",
      } as any);
      prisma.tenant.update.mockResolvedValue({
        id: TENANT_ID,
        status: "ACTIVE",
        subdomain: "acme",
      } as any);
      prisma.user.updateMany.mockResolvedValue({ count: 1 } as any);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 } as any);
      prisma.user.findMany.mockResolvedValue([] as any);

      await svc.updateStatus(
        TENANT_ID,
        { status: TenantStatus.ACTIVE } as any,
        ACTOR_ID,
        ACTOR_EMAIL,
      );

      // Reactivation is not an ACTIVE→suspend/delete edge, so no parking.
      expect(reserveSubdomain).not.toHaveBeenCalled();
      // But the privilege change still forces a re-login.
      expect(prisma.user.updateMany).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "ACTIVATE" }),
      );
    });
  });

  describe("getOverrides", () => {
    it("throws NotFound for a missing tenant", async () => {
      prisma.tenant.findUnique.mockResolvedValue(null as any);
      await expect(svc.getOverrides(TENANT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("reports the engine's projection as effective, not plan columns", async () => {
      // Regression: this used to layer overrides over tenant.currentPlan.
      // currentPlanId is null on every tenant since v3.3.0, so the editor
      // showed a tenant with the whole free core plus everything they had
      // bought as though they had nothing at all.
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        featureOverrides: { advancedReports: true },
        limitOverrides: null,
      } as any);
      entitlements.getForTenant.mockResolvedValue({
        features: { posAccess: true, advancedReports: true, license: true },
        limits: { maxBranches: 3 },
        integrations: { delivery: ["getir"] },
        computedAt: "2026-08-11T00:00:00.000Z",
      });
      prisma.featureEntitlement.findMany.mockResolvedValue([] as any);

      const res = await svc.getOverrides(TENANT_ID);

      expect(res.effective.features.posAccess).toBe(true);
      expect(res.effective.limits.maxBranches).toBe(3);
      expect(res.effective.integrations.delivery).toEqual(["getir"]);
      expect(res.featureOverrides).toEqual({ advancedReports: true });
    });

    it("breaks each grant down by source so 'why does this tenant have X' is answerable", async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        featureOverrides: null,
        limitOverrides: null,
      } as any);
      prisma.featureEntitlement.findMany.mockResolvedValue([
        { key: "feature.posAccess", value: true, source: "free:baseline" },
        { key: "limit.maxBranches", value: 1, source: "free:baseline" },
        { key: "limit.maxBranches", value: 2, source: "addon:extra_branch:ta-1" },
        { key: "feature.apiAccess", value: true, source: "override:admin" },
      ] as any);

      const res = await svc.getOverrides(TENANT_ID);

      expect(res.sources["limit.maxBranches"]).toEqual([
        "free:baseline",
        "addon:extra_branch:ta-1",
      ]);
      expect(res.sources["feature.apiAccess"]).toEqual(["override:admin"]);
    });
  });

  describe("updateOverrides", () => {
    it("merges whitelisted keys, deletes null/undefined, and emits a reprojection event", async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        name: "Acme",
        featureOverrides: { advancedReports: true },
        limitOverrides: { maxBranches: 2 },
      } as any);
      prisma.tenant.update.mockResolvedValue({} as any);

      const res = await svc.updateOverrides(
        TENANT_ID,
        {
          featureOverrides: { advancedReports: null, apiAccess: true } as any,
          limitOverrides: { maxBranches: 4 } as any,
        } as any,
        ACTOR_ID,
        ACTOR_EMAIL,
      );

      // advancedReports null → removed; apiAccess true → added.
      expect(res.featureOverrides).toEqual({ apiAccess: true });
      expect(res.limitOverrides).toEqual({ maxBranches: 4 });
      // Appended INSIDE the tenant-update transaction (tx-aware append) so the
      // override write + reprojection event commit atomically.
      expect(outbox.append).toHaveBeenCalledTimes(1);
      expect(outbox.append.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          type: EventTypes.TenantOverridesChanged,
          tenantId: TENANT_ID,
        }),
      );
      // Second positional arg is the transaction client (tx-aware append).
      expect(outbox.append.mock.calls[0].length).toBe(2);
    });

    it("collapses an emptied override map to null (JsonNull persisted)", async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        name: "Acme",
        featureOverrides: { advancedReports: true },
        limitOverrides: {},
      } as any);
      prisma.tenant.update.mockResolvedValue({} as any);

      const res = await svc.updateOverrides(
        TENANT_ID,
        { featureOverrides: { advancedReports: null } as any } as any,
        ACTOR_ID,
        ACTOR_EMAIL,
      );
      expect(res.featureOverrides).toBeNull();
    });

    it("propagates a failed reprojection enqueue (no longer swallowed) so the override write rolls back", async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        name: "Acme",
        featureOverrides: {},
        limitOverrides: {},
      } as any);
      prisma.tenant.update.mockResolvedValue({} as any);
      outbox.append.mockRejectedValueOnce(new Error("outbox down"));

      await expect(
        svc.updateOverrides(
          TENANT_ID,
          { featureOverrides: { apiAccess: true } as any } as any,
          ACTOR_ID,
          ACTOR_EMAIL,
        ),
      ).rejects.toThrow(/outbox down/);
      // Audit runs only AFTER the transaction commits, so a failed enqueue
      // must not have written an audit row either.
      expect(audit.log).not.toHaveBeenCalled();
    });
  });
});
