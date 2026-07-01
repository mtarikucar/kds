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
    svc = new SuperAdminTenantsService(
      prisma as any,
      audit as any,
      notifications as any,
      email as any,
      outbox as any,
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

      expect(reserveSubdomain).toHaveBeenCalledWith(
        prisma,
        "acme",
        "tenant_suspended",
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

    it("layers feature overrides over plan defaults to compute effective features", async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        featureOverrides: { advancedReports: true, apiAccess: false },
        limitOverrides: { maxUsers: 99 },
        currentPlan: {
          advancedReports: false,
          multiLocation: true,
          customBranding: false,
          apiAccess: true,
          prioritySupport: false,
          inventoryTracking: false,
          kdsIntegration: false,
          reservationSystem: false,
          personnelManagement: false,
          deliveryIntegration: false,
          maxUsers: 5,
          maxTables: 10,
          maxProducts: 100,
          maxCategories: 20,
          maxMonthlyOrders: 1000,
        },
      } as any);

      const res = await svc.getOverrides(TENANT_ID);
      // override wins over the plan default
      expect(res.effective.features.advancedReports).toBe(true);
      expect(res.effective.features.apiAccess).toBe(false);
      // plan default flows through where there's no override
      expect(res.effective.features.multiLocation).toBe(true);
      expect(res.effective.limits.maxUsers).toBe(99); // override
      expect(res.effective.limits.maxTables).toBe(10); // plan default
    });

    // M10: posAccess (feature) and maxBranches (limit) are in
    // FEATURE_KEYS/LIMIT_KEYS so updateOverrides accepts them, but the plan
    // default the override editor reads on the left omitted them — the editor
    // was blind to those keys on read. Surface the plan default so the
    // override row shows the correct baseline + effective value.
    it("exposes posAccess and maxBranches plan defaults so the override editor can show them", async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        featureOverrides: null,
        limitOverrides: null,
        currentPlan: {
          advancedReports: false,
          multiLocation: false,
          customBranding: false,
          apiAccess: false,
          externalDisplay: true,
          prioritySupport: false,
          inventoryTracking: false,
          kdsIntegration: true,
          reservationSystem: false,
          personnelManagement: false,
          deliveryIntegration: true,
          posAccess: false,
          maxUsers: 5,
          maxTables: 10,
          maxBranches: -1,
          maxProducts: 100,
          maxCategories: 20,
          maxMonthlyOrders: 1000,
        },
      } as any);

      const res = await svc.getOverrides(TENANT_ID);
      // Plan-default column now carries the previously-omitted keys.
      expect(res.planDefaults.features.posAccess).toBe(false);
      expect(res.planDefaults.features.deliveryIntegration).toBe(true);
      expect(res.planDefaults.features.externalDisplay).toBe(true);
      expect(res.planDefaults.limits.maxBranches).toBe(-1);
      // ...and they flow through to effective with no override.
      expect(res.effective.features.posAccess).toBe(false);
      expect(res.effective.limits.maxBranches).toBe(-1);
    });
  });

  describe("updateOverrides", () => {
    it("merges whitelisted keys, deletes null/undefined, and emits a reprojection event", async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        name: "Acme",
        featureOverrides: { advancedReports: true },
        limitOverrides: { maxUsers: 50 },
      } as any);
      prisma.tenant.update.mockResolvedValue({} as any);

      const res = await svc.updateOverrides(
        TENANT_ID,
        {
          featureOverrides: { advancedReports: null, apiAccess: true } as any,
          limitOverrides: { maxUsers: 75 } as any,
        } as any,
        ACTOR_ID,
        ACTOR_EMAIL,
      );

      // advancedReports null → removed; apiAccess true → added.
      expect(res.featureOverrides).toEqual({ apiAccess: true });
      expect(res.limitOverrides).toEqual({ maxUsers: 75 });
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
