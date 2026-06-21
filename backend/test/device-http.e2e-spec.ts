import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  bootHttpApp,
  resetDb,
  seedLiveTenant,
  loginAs,
} from "./helpers/e2e-db";

/**
 * HTTP-level coverage for device-slot creation through the full guard chain
 * (Jwt → Roles → Tenant → Branch → SubscriptionStatus). The original prod bug
 * was the controller NOT forwarding the branch from the X-Branch-Id scope — a
 * gap a service-level test can't see. The first case reproduces exactly that
 * path (body has no branchId; it must come from the header). The second is the
 * cross-tenant isolation guarantee.
 */
describe("Device mesh — POST /v1/devices (HTTP, real guards)", () => {
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

  it("creates a device using the branch from the X-Branch-Id scope (no body branchId)", async () => {
    const t = await seedLiveTenant(prisma);
    const token = await loginAs(app, t.email, t.password);

    const res = await request(app.getHttpServer())
      .post("/api/v1/devices")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Branch-Id", t.branchId)
      .send({ kind: "kds_screen" })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.pairCode).toMatch(/^[A-Z0-9]{6}$/);

    const row = await prisma.device.findUnique({ where: { id: res.body.id } });
    expect(row).not.toBeNull();
    expect(row!.branchId).toBe(t.branchId);
    expect(row!.tenantId).toBe(t.tenantId);
  });

  it("denies a branch that belongs to another tenant (cross-tenant isolation)", async () => {
    const a = await seedLiveTenant(prisma);
    const b = await seedLiveTenant(prisma);
    const tokenA = await loginAs(app, a.email, a.password);

    await request(app.getHttpServer())
      .post("/api/v1/devices")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Branch-Id", b.branchId) // tenant A trying to use tenant B's branch
      .send({ kind: "kds_screen" })
      .expect(403);

    expect(await prisma.device.count({ where: { branchId: b.branchId } })).toBe(
      0,
    );
  });

  it("rejects a branch-scoped request with no X-Branch-Id header", async () => {
    const t = await seedLiveTenant(prisma);
    const token = await loginAs(app, t.email, t.password);

    await request(app.getHttpServer())
      .post("/api/v1/devices")
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "kds_screen" })
      .expect(400);
  });
});
