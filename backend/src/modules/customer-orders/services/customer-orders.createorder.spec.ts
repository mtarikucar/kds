import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { CustomerOrdersService } from "./customer-orders.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Real-logic spec for CustomerOrdersService.createOrder pre-create guards.
 * The existing customer-orders spec covers waiter/bill-request dedup but
 * NOT the createOrder validation cascade, which encodes the highest-value
 * business rules of the QR-ordering path:
 *  - server-trusted tenant resolution (never from the body).
 *  - tenant existence + ACTIVE-status gate.
 *  - customer-ordering-disabled gate.
 *  - geofencing: missing coords + out-of-range rejection (only when the
 *    tenant has valid coordinates configured).
 *  - branch selection: table → table.branchId (table-not-found path);
 *    tableless → enableTablelessMode gate + no-active-branch gate.
 *
 * Each test drives the cascade to exactly one guard and asserts the throw,
 * proving the branch order + the exact error type.
 */
describe("CustomerOrdersService.createOrder — guards", () => {
  const TENANT = "t1";
  let prisma: MockPrismaClient;
  let posSettings: { findByTenant: jest.Mock };
  let sessionService: { requireSession: jest.Mock };
  let customersService: { findOrCreateByPhone: jest.Mock };
  let svc: CustomerOrdersService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    sessionService = {
      requireSession: jest.fn().mockResolvedValue({ tenantId: TENANT }),
    };
    posSettings = {
      findByTenant: jest.fn().mockResolvedValue({
        enableCustomerOrdering: true,
        enableTablelessMode: true,
      }),
    };
    customersService = { findOrCreateByPhone: jest.fn() };
    svc = new CustomerOrdersService(
      prisma as any,
      posSettings as any,
      {} as any, // kdsGateway (unused before order.create)
      customersService as any,
      sessionService as any,
    );
  });

  // A tenant with NO coordinates configured → geofencing skipped.
  function tenantNoGeo(over: any = {}) {
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: TENANT,
      status: "ACTIVE",
      latitude: null,
      longitude: null,
      locationRadius: 100,
      ...over,
    });
  }

  const baseDto = { sessionId: "s-1", items: [{}] } as any;

  it("resolves tenantId from the session, not the request body", async () => {
    sessionService.requireSession.mockResolvedValue({ tenantId: "trusted-t" });
    (prisma.tenant.findUnique as any).mockResolvedValue(null);

    await svc
      .createOrder({ ...baseDto, tenantId: "evil-t" } as any)
      .catch(() => {});

    expect(prisma.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "trusted-t" } }),
    );
  });

  it("throws NotFound when the tenant does not exist", async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(null);
    await expect(svc.createOrder(baseDto)).rejects.toThrow(NotFoundException);
  });

  it("throws Forbidden when the tenant is not ACTIVE", async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: TENANT,
      status: "SUSPENDED",
      latitude: null,
      longitude: null,
      locationRadius: 100,
    });
    await expect(svc.createOrder(baseDto)).rejects.toThrow(
      /Tenant is not active/,
    );
  });

  it("throws Forbidden when customer ordering is disabled", async () => {
    tenantNoGeo();
    posSettings.findByTenant.mockResolvedValue({
      enableCustomerOrdering: false,
    });
    await expect(svc.createOrder(baseDto)).rejects.toThrow(
      /Customer ordering is currently disabled/,
    );
  });

  describe("geofencing (tenant has valid coordinates)", () => {
    function tenantWithGeo() {
      (prisma.tenant.findUnique as any).mockResolvedValue({
        id: TENANT,
        status: "ACTIVE",
        latitude: 41.0,
        longitude: 29.0,
        locationRadius: 100,
      });
    }

    it("rejects when the customer sends no coordinates", async () => {
      tenantWithGeo();
      await expect(
        svc.createOrder({ ...baseDto, tableId: "tb-1" }),
      ).rejects.toThrow(/Konum bilgisi gerekli/);
    });

    it("rejects when the customer is outside the allowed radius", async () => {
      tenantWithGeo();
      // A point far from (41,29) → out of the 100m radius.
      await expect(
        svc.createOrder({
          ...baseDto,
          tableId: "tb-1",
          latitude: 0,
          longitude: 0,
        }),
      ).rejects.toThrow(/restoran konumunda olmanız gerekiyor/);
    });
  });

  describe("branch selection", () => {
    it("throws NotFound when the supplied tableId does not belong to the tenant", async () => {
      tenantNoGeo();
      (prisma.table.findFirst as any).mockResolvedValue(null);

      await expect(
        svc.createOrder({ ...baseDto, tableId: "tb-x" }),
      ).rejects.toThrow(/Table not found/);
      // Scoped to {id, tenantId}.
      const arg = (prisma.table.findFirst as any).mock.calls[0][0];
      expect(arg.where).toEqual({ id: "tb-x", tenantId: TENANT });
    });

    it("rejects tableless ordering when enableTablelessMode is off", async () => {
      tenantNoGeo();
      posSettings.findByTenant.mockResolvedValue({
        enableCustomerOrdering: true,
        enableTablelessMode: false,
      });

      await expect(svc.createOrder(baseDto)).rejects.toThrow(
        /Tableless ordering is not enabled/,
      );
    });

    it("rejects tableless ordering when the tenant has no active branch", async () => {
      tenantNoGeo();
      (prisma.branch.findFirst as any).mockResolvedValue(null);

      await expect(svc.createOrder(baseDto)).rejects.toThrow(
        /no active branch/,
      );
      // The tableless branch picks the oldest active branch.
      const arg = (prisma.branch.findFirst as any).mock.calls[0][0];
      expect(arg.where).toEqual({ tenantId: TENANT, status: "active" });
      expect(arg.orderBy).toEqual({ createdAt: "asc" });
    });
  });

  // deep-review H13/M14 — the public QR path must enforce
  // modifier-belongs-to-product (parity with the staff path). A customer
  // attaching a modifier defined for a DIFFERENT product (e.g. a free /
  // negative-price add-on) must be rejected before pricing so it can't
  // lower the line total or pollute the kitchen ticket.
  describe("modifier-belongs-to-product guard (deep-review H13/M14)", () => {
    it("rejects a foreign modifier not in any of the product's groups", async () => {
      tenantNoGeo();
      (prisma.table.findFirst as any).mockResolvedValue({
        id: "tb-1",
        branchId: "b1",
      });
      // Product "Cola" has a single active group whose only allowed
      // modifier is "mod-allowed". The DTO attaches "mod-foreign", which
      // belongs to another product entirely.
      (prisma.product.findMany as any).mockResolvedValue([
        {
          id: "p-cola",
          name: "Cola",
          price: 10,
          modifierGroups: [
            {
              group: {
                isActive: true,
                isRequired: false,
                minSelections: 0,
                maxSelections: 0,
                displayName: "Extras",
                modifiers: [{ id: "mod-allowed" }],
              },
            },
          ],
        },
      ]);

      await expect(
        svc.createOrder({
          ...baseDto,
          tableId: "tb-1",
          items: [
            {
              productId: "p-cola",
              quantity: 1,
              modifiers: [{ modifierId: "mod-foreign", quantity: 1 }],
            },
          ],
        } as any),
      ).rejects.toThrow(/Modifier mod-foreign is not allowed/);

      // Guard fires before the pricing-pass modifier fetch — the foreign
      // modifier's priceAdjustment never gets a chance to reach the total.
      expect((prisma.modifier.findMany as any).mock.calls.length).toBe(0);
      // And no order row is created.
      expect((prisma.order.create as any).mock.calls.length).toBe(0);
    });
  });
});
