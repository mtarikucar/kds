import { AuthService } from "./auth.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";

/**
 * AuthService.completeProfile — post-social-login onboarding. Saves the
 * required phone + optional business details atomically across User + Tenant +
 * the Main branch. Tenant/branch mutations are ADMIN-only (the DB role is
 * consulted inside the transaction); staff callers still get their
 * user-scoped fields saved but can never rename the restaurant or rewrite
 * tax/address data.
 */
describe("AuthService.completeProfile", () => {
  let prisma: MockPrismaClient;
  let svc: AuthService;
  const USER = "u1";
  const TENANT = "t1";

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new AuthService(
      prisma as any,
      { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() } as any,
      { get: jest.fn(() => undefined) } as any,
      {} as any,
      {} as any,
    );
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn(prisma),
    );
    // Default caller is an ADMIN — the tx role lookup and the final profile
    // refetch share this mock.
    (prisma.user.findUnique as any).mockResolvedValue({
      id: USER,
      role: "ADMIN",
      phone: "+905551234567",
    });
  });

  it("saves phone (required) + business + tax + timezone across User/Tenant/Branch", async () => {
    (prisma.branch.findFirst as any).mockResolvedValue({ id: "b1", address: {} });

    await svc.completeProfile(USER, TENANT, {
      phone: "+905551234567",
      firstName: "Vic",
      lastName: "Tim",
      businessName: "Vic's Diner",
      taxId: "1234567890",
      taxOffice: "Kadıköy",
      addressLine: "Atatürk Cad. 1",
      city: "İstanbul",
      timezone: "Europe/Istanbul",
      locale: "tr",
    } as any);

    // User: phone + name + locale
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER },
        data: expect.objectContaining({
          phone: "+905551234567",
          firstName: "Vic",
          locale: "tr",
        }),
      }),
    );
    // Tenant: business name + tax + timezone
    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TENANT },
        data: expect.objectContaining({
          name: "Vic's Diner",
          taxId: "1234567890",
          taxOffice: "Kadıköy",
          timezone: "Europe/Istanbul",
        }),
      }),
    );
    // Main branch address merged
    expect(prisma.branch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "b1" },
        data: expect.objectContaining({
          address: expect.objectContaining({
            line1: "Atatürk Cad. 1",
            city: "İstanbul",
          }),
        }),
      }),
    );
  });

  it("only writes phone when no optional fields are supplied (no tenant/branch update)", async () => {
    await svc.completeProfile(USER, TENANT, { phone: "+905559998877" } as any);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: "+905559998877" }),
      }),
    );
    expect(prisma.tenant.update).not.toHaveBeenCalled();
    expect(prisma.branch.update).not.toHaveBeenCalled();
  });

  it.each(["WAITER", "KITCHEN", "COURIER", "MANAGER"])(
    "SECURITY: a %s caller sending business/tax/address fields saves ONLY user fields — tenant and branch stay untouched",
    async (role) => {
      (prisma.user.findUnique as any).mockResolvedValue({
        id: USER,
        role,
        phone: "+905551112233",
      });
      (prisma.branch.findFirst as any).mockResolvedValue({
        id: "b1",
        address: {},
      });

      await svc.completeProfile(USER, TENANT, {
        phone: "+905551112233",
        firstName: "Wai",
        lastName: "Ter",
        locale: "en",
        businessName: "HIJACKED NAME",
        taxId: "666",
        taxOffice: "Nowhere",
        addressLine: "Evil St. 1",
        city: "Gotham",
        timezone: "UTC",
      } as any);

      // User-scoped fields still land (the call must succeed for staff).
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER },
          data: expect.objectContaining({
            phone: "+905551112233",
            firstName: "Wai",
            lastName: "Ter",
            locale: "en",
          }),
        }),
      );
      // Tenant identity + HQ address must be untouched by non-admin callers.
      expect(prisma.tenant.update).not.toHaveBeenCalled();
      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
      expect(prisma.branch.update).not.toHaveBeenCalled();
    },
  );

  it("admin caller still updates tenant + branch (role read from DB, not JWT)", async () => {
    (prisma.branch.findFirst as any).mockResolvedValue({ id: "b1", address: {} });

    await svc.completeProfile(USER, TENANT, {
      phone: "+905551234567",
      businessName: "Legit Rename",
    } as any);

    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TENANT },
        data: expect.objectContaining({ name: "Legit Rename" }),
      }),
    );
  });
});
