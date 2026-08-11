import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { bootHttpApp, resetDb, seedLiveTenant, loginAs } from "./helpers/e2e-db";

/**
 * What locks a tenant out now, through the full guard chain on a real DB.
 *
 * v3.3.0 deleted SubscriptionStatusGuard: the core product is free, so there
 * is no subscription state left to lock on. Nothing replaced it, and this file
 * is the evidence that nothing needed to — `JwtStrategy.validate` already
 * rejects any request whose tenant is not ACTIVE, on every authenticated
 * route, from a live read. (An earlier attempt added a TenantStatusGuard on
 * the theory that the lever had been lost with the old guard; running these
 * tests showed the lever was one layer up all along, so the duplicate was
 * removed rather than kept as a weaker, cached second opinion.)
 *
 * The two properties that matter:
 *   - a tenant who has bought NOTHING can use the free core;
 *   - a SUSPENDED tenant cannot reach anything authenticated.
 */
describe("Tenant status lock (HTTP, real guards)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await bootHttpApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("an unlicensed tenant can use the free core", async () => {
    // The headline change. No plan, no licence, no purchase of any kind, and
    // the app works. Under the old guard this exact tenant was 403'd on every
    // branch-scoped route.
    const t = await seedLiveTenant(prisma);
    const token = await loginAs(app, t.email, t.password);

    await request(app.getHttpServer())
      .get("/api/v1/devices")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Branch-Id", t.branchId)
      .expect(200);
  });

  it("still works after the subscription is expired outright", async () => {
    // Entitlement no longer depends on billing state at all: an EXPIRED
    // subscription row is a historical record, not a gate.
    const t = await seedLiveTenant(prisma);
    await prisma.subscription.updateMany({
      where: { tenantId: t.tenantId },
      data: { status: "EXPIRED" },
    });
    const token = await loginAs(app, t.email, t.password);

    await request(app.getHttpServer())
      .get("/api/v1/devices")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Branch-Id", t.branchId)
      .expect(200);
  });

  it("a SUSPENDED tenant is rejected on an already-issued token", async () => {
    // Live read, so suspension bites immediately — the token the operator is
    // already holding stops working on the next request rather than at expiry.
    const t = await seedLiveTenant(prisma);
    const token = await loginAs(app, t.email, t.password);
    await prisma.tenant.update({
      where: { id: t.tenantId },
      data: { status: "SUSPENDED" },
    });

    await request(app.getHttpServer())
      .get("/api/v1/devices")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Branch-Id", t.branchId)
      .expect(401);
  });

  it("a SUSPENDED tenant cannot reach tenant-wide routes either", async () => {
    // The rejection is at the token layer, so it is not route-scoped: there is
    // no allowlist to get wrong.
    const t = await seedLiveTenant(prisma);
    const token = await loginAs(app, t.email, t.password);
    await prisma.tenant.update({
      where: { id: t.tenantId },
      data: { status: "SUSPENDED" },
    });

    await request(app.getHttpServer())
      .get("/api/auth/profile")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });
});
