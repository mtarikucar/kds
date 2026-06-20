import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { DeviceService } from "../src/modules/device-mesh/device.service";
import { bootE2EApp, resetDb, seedTenantBranchUser } from "./helpers/e2e-db";

/**
 * Real-DB coverage for device-slot creation. Before the v3.2.18 fix this exact
 * create wrote `branchId: ... ?? null` into the NOT NULL devices.branchId, which
 * the real Prisma engine rejected with "Argument `tenant` is missing" — a class
 * of bug the mocked-Prisma unit tests could not catch.
 */
describe("Device mesh — createSlot (real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let devices: DeviceService;

  beforeAll(async () => {
    ({ app, prisma } = await bootE2EApp());
    devices = app.get(DeviceService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("persists a device row in the given branch (no NOT NULL / relation error)", async () => {
    const { tenantId, branchId } = await seedTenantBranchUser(prisma);

    const out = await devices.createSlot(tenantId, {
      kind: "kds_screen",
      branchId,
    });

    expect(out.id).toBeDefined();
    expect(out.pairCode).toMatch(/^[A-Z0-9]{6}$/);

    const row = await prisma.device.findUnique({ where: { id: out.id } });
    expect(row).not.toBeNull();
    expect(row!.tenantId).toBe(tenantId);
    expect(row!.branchId).toBe(branchId);
    expect(row!.status).toBe("unprovisioned");
  });

  it("rejects a slot with no branch (branch-scope-strict)", async () => {
    const { tenantId } = await seedTenantBranchUser(prisma);
    await expect(
      devices.createSlot(tenantId, { kind: "kds_screen" } as any),
    ).rejects.toThrow(/branchId is required/i);
    expect(await prisma.device.count()).toBe(0);
  });

  it("rejects a branch that belongs to another tenant", async () => {
    const a = await seedTenantBranchUser(prisma);
    const b = await seedTenantBranchUser(prisma);
    await expect(
      devices.createSlot(a.tenantId, {
        kind: "kds_screen",
        branchId: b.branchId,
      }),
    ).rejects.toThrow(/branch not found/i);
    expect(await prisma.device.count()).toBe(0);
  });
});
