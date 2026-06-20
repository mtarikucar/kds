import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { bootE2EApp, resetDb, seedTenantBranchUser } from "./helpers/e2e-db";

/**
 * Real-DB coverage for the post-social-login onboarding write path
 * (AuthService.completeProfile). Exercises the atomic multi-table update across
 * User + Tenant + the Main branch against the real schema (added in v3.2.17:
 * users.locale, tenants.taxOffice, branch.address merge).
 */
describe("Onboarding — completeProfile (real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;

  beforeAll(async () => {
    ({ app, prisma } = await bootE2EApp());
    auth = app.get(AuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("writes phone + business + tax + timezone + address across User/Tenant/Branch", async () => {
    const { tenantId, branchId, userId } = await seedTenantBranchUser(prisma, {
      userPhone: null,
    });

    await auth.completeProfile(userId, tenantId, {
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

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user!.phone).toBe("+905551234567");
    expect(user!.firstName).toBe("Vic");
    expect(user!.locale).toBe("tr");

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(tenant!.name).toBe("Vic's Diner");
    expect(tenant!.taxId).toBe("1234567890");
    expect(tenant!.taxOffice).toBe("Kadıköy");
    expect(tenant!.timezone).toBe("Europe/Istanbul");

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    const address = branch!.address as Record<string, unknown>;
    expect(address.line1).toBe("Atatürk Cad. 1");
    expect(address.city).toBe("İstanbul");
  });

  it("only writes phone when no optional fields are supplied (tenant untouched)", async () => {
    const { tenantId, userId } = await seedTenantBranchUser(prisma, {
      userPhone: null,
    });
    const before = await prisma.tenant.findUnique({ where: { id: tenantId } });

    await auth.completeProfile(userId, tenantId, {
      phone: "+905559998877",
    } as any);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user!.phone).toBe("+905559998877");

    const after = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(after!.name).toBe(before!.name); // business name not overwritten
  });
});
