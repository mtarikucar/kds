import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { PlanProjectorService } from "../src/modules/entitlements/plan-projector.service";
import { bootHttpApp, resetDb, seedLiveTenant, loginAs } from "./helpers/e2e-db";

/**
 * HTTP-level coverage for the Partner Display API through the FULL guard chain.
 * This is the only layer that proves the @MachineAuth reachability class —
 * mocked-Prisma unit tests can't see that the global Jwt/Branch guards must
 * step aside so PartnerKeyGuard / ScreenTokenGuard authenticate (the same gap
 * the device-mesh heartbeat routes had). Also exercises the EXTERNAL_DISPLAY
 * plan gate and the revoke→screen-token-death cascade end to end.
 *
 * Runs against the throwaway CI Postgres (db push + Redis service container) —
 * NOT a dev DB (resetDb TRUNCATEs every table).
 */
describe("Partner Display API (HTTP, real guards)", () => {
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

  // Enable the feature on the seeded tenant's plan, then project entitlements
  // so the engine surfaces feature.externalDisplay (what both PlanFeatureGuard
  // and PartnerKeyGuard read). Mirrors what a real BUSINESS/TRIAL tenant gets.
  async function enableExternalDisplay(tenantId: string): Promise<void> {
    await prisma.subscriptionPlan.updateMany({
      data: { externalDisplay: true },
    });
    await app.get(PlanProjectorService).projectTenant(tenantId);
  }

  function issueKey(token: string, body: Record<string, unknown> = { name: "Partner" }) {
    return request(app.getHttpServer())
      .post("/api/v1/partner/api-keys")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  function mintScreen(keyId: string, secret: string | undefined, branchId: string) {
    const req = request(app.getHttpServer())
      .post("/api/v1/partner/screen-sessions")
      .set("X-Partner-Key", keyId);
    if (secret) req.set("X-Partner-Secret", secret);
    return req.send({ branchId });
  }

  function readMenu(screenToken: string) {
    return request(app.getHttpServer())
      .get("/api/v1/display/menu")
      .set("Authorization", `Screen ${screenToken}`);
  }

  it("full chain: ADMIN issues key → partner mints screen token → screen reads menu", async () => {
    const t = await seedLiveTenant(prisma);
    await enableExternalDisplay(t.tenantId);
    const token = await loginAs(app, t.email, t.password);

    const keyRes = await issueKey(token, {
      name: "Tablet Partner",
      scopes: ["menu:read", "orders:write", "realtime:subscribe"],
    }).expect(201);
    expect(keyRes.body.keyId).toMatch(/^pk_live_/);
    expect(keyRes.body.secret).toMatch(/^pk_live_secret_/);
    expect(keyRes.body.secretHash).toBeUndefined();

    const mintRes = await mintScreen(
      keyRes.body.keyId,
      keyRes.body.secret,
      t.branchId,
    ).expect(201);
    expect(mintRes.body.screenToken).toContain(".");
    expect(mintRes.body.refreshToken).toContain(".");
    expect(mintRes.body.orderingSessionId).toMatch(/^[0-9a-f]{64}$/);

    const menuRes = await readMenu(mintRes.body.screenToken).expect(200);
    expect(menuRes.body.tenant.id).toBe(t.tenantId);
  });

  it("denies key issuance for a tenant WITHOUT the externalDisplay feature (403)", async () => {
    const t = await seedLiveTenant(prisma); // feature left disabled
    const token = await loginAs(app, t.email, t.password);
    await issueKey(token).expect(403);
  });

  it("rejects a screen mint missing X-Partner-Secret (401)", async () => {
    const t = await seedLiveTenant(prisma);
    await enableExternalDisplay(t.tenantId);
    const token = await loginAs(app, t.email, t.password);
    const keyRes = await issueKey(token).expect(201);
    await mintScreen(keyRes.body.keyId, undefined, t.branchId).expect(401);
  });

  it("rejects a /display request with no screen token (401)", async () => {
    await readMenu("").expect(401);
  });

  it("revoking the key cascades: the screen token stops working (401)", async () => {
    const t = await seedLiveTenant(prisma);
    await enableExternalDisplay(t.tenantId);
    const token = await loginAs(app, t.email, t.password);
    const keyRes = await issueKey(token).expect(201);
    const mintRes = await mintScreen(
      keyRes.body.keyId,
      keyRes.body.secret,
      t.branchId,
    ).expect(201);

    // Works before revoke.
    await readMenu(mintRes.body.screenToken).expect(200);

    // Revoke the parent key.
    await request(app.getHttpServer())
      .delete(`/api/v1/partner/api-keys/${keyRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    // The minted screen token is now dead (cascade revocation).
    await readMenu(mintRes.body.screenToken).expect(401);
  });
});
