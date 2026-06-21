import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { bootHttpApp, resetDb, seedLiveTenant, loginAs } from "./helpers/e2e-db";

/**
 * The onboarding-trial lock (SubscriptionStatusGuard). A tenant with a live
 * subscription (TRIALING/ACTIVE/PAST_DUE) can use the app; once the trial ends
 * (status TRIAL_ENDED, no paid plan) every tenant-scoped route is 403'd with
 * PLAN_SELECTION_REQUIRED EXCEPT the recovery allowlist (auth/subscriptions/...).
 * This exercises that money/lock path through the full guard chain on a real DB.
 */
describe("Subscription lock (HTTP, real guards)", () => {
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

  it("a TRIALING tenant can reach a branch-scoped route", async () => {
    const t = await seedLiveTenant(prisma); // seeds a TRIALING subscription
    const token = await loginAs(app, t.email, t.password);

    await request(app.getHttpServer())
      .get("/api/v1/devices")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Branch-Id", t.branchId)
      .expect(200);
  });

  it("a TRIAL_ENDED tenant is locked out of branch-scoped routes", async () => {
    const t = await seedLiveTenant(prisma);
    await prisma.subscription.updateMany({
      where: { tenantId: t.tenantId },
      data: { status: "TRIAL_ENDED" },
    });
    const token = await loginAs(app, t.email, t.password);

    const res = await request(app.getHttpServer())
      .get("/api/v1/devices")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Branch-Id", t.branchId)
      .expect(403);

    expect(JSON.stringify(res.body)).toMatch(/PLAN_SELECTION_REQUIRED/);
  });

  it("a locked tenant can still reach a recovery route (auth)", async () => {
    const t = await seedLiveTenant(prisma);
    await prisma.subscription.updateMany({
      where: { tenantId: t.tenantId },
      data: { status: "TRIAL_ENDED" },
    });
    const token = await loginAs(app, t.email, t.password);

    // /auth is on the SubscriptionStatusGuard allowlist — profile must load so
    // the locked user can still see who they are and navigate to choose a plan.
    await request(app.getHttpServer())
      .get("/api/auth/profile")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
  });
});
