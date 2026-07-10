import { DeviceService } from "./device.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";

/** Minimal ConfigService stub honouring the (key, default) signature. */
function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn((key: string, def?: unknown) =>
      key in overrides ? overrides[key] : def,
    ),
  } as any;
}

/**
 * Smoke tests for the most security-relevant flows on DeviceService: pairing
 * and token authentication. The full integration story (heartbeat sweeps,
 * command queue interaction) lives in the e2e suite once the mesh is wired
 * to a real Postgres in CI.
 */
describe("DeviceService pairing", () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: DeviceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue("outbox-id") };
    svc = new DeviceService(prisma as any, outbox as any, makeConfig());
  });

  describe("TTL config", () => {
    const TEN_MIN_MS = 10 * 60 * 1000;

    it("pairCode TTL defaults to 10m when DEVICE_PAIR_CODE_TTL_MS is unset", async () => {
      prisma.device.findUnique.mockResolvedValue(null);
      (prisma.branch.findFirst as any).mockResolvedValue({ id: "branch-1" });
      (prisma.device.create as any).mockImplementation(
        async ({ data }: any) => ({ id: "dev-1", ...data }),
      );

      const before = Date.now();
      const out = await svc.createSlot("tenant-1", {
        kind: "kds_screen",
        branchId: "branch-1",
      });
      const ttl = out.pairCodeExpiresAt.getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(TEN_MIN_MS - 1000);
      expect(ttl).toBeLessThanOrEqual(TEN_MIN_MS + 5000);
    });

    it("honours a DEVICE_PAIR_CODE_TTL_MS override", async () => {
      const override = 90 * 1000;
      svc = new DeviceService(
        prisma as any,
        outbox as any,
        makeConfig({ DEVICE_PAIR_CODE_TTL_MS: override }),
      );
      prisma.device.findUnique.mockResolvedValue(null);
      (prisma.branch.findFirst as any).mockResolvedValue({ id: "branch-1" });
      (prisma.device.create as any).mockImplementation(
        async ({ data }: any) => ({ id: "dev-1", ...data }),
      );

      const before = Date.now();
      const out = await svc.createSlot("tenant-1", {
        kind: "kds_screen",
        branchId: "branch-1",
      });
      const ttl = out.pairCodeExpiresAt.getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(override - 1000);
      expect(ttl).toBeLessThanOrEqual(override + 5000);
    });
  });

  it("createSlot generates a pair code and stores it with TTL", async () => {
    prisma.device.findUnique.mockResolvedValue(null);
    (prisma.branch.findFirst as any).mockResolvedValue({ id: "branch-1" });
    // Cast through unknown because the Prisma client return type is the
    // (very deep) PrismaPromise wrapper; for these tests the resolved
    // object is all we need to assert against.
    (prisma.device.create as any).mockImplementation(async ({ data }: any) => ({
      id: "dev-1",
      ...data,
    }));

    const out = await svc.createSlot("tenant-1", {
      kind: "kds_screen",
      branchId: "branch-1",
    });

    expect(out.pairCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(out.pairCodeExpiresAt).toBeInstanceOf(Date);
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: "device.slot_created.v1" }),
    );
  });

  it("createSlot connects tenant + branch as relations (not scalar FKs)", async () => {
    prisma.device.findUnique.mockResolvedValue(null);
    (prisma.branch.findFirst as any).mockResolvedValue({ id: "branch-1" });
    const captured: any = {};
    (prisma.device.create as any).mockImplementation(async (args: any) => {
      Object.assign(captured, args);
      return { id: "dev-1", ...args.data };
    });

    await svc.createSlot("tenant-1", {
      kind: "kds_screen",
      branchId: "branch-1",
    });

    // Relation connect form — guards against the regression where a scalar
    // `branchId: null` made Prisma fall back to the checked-create variant and
    // throw "Argument `tenant` is missing".
    expect(captured.data.tenant).toEqual({ connect: { id: "tenant-1" } });
    expect(captured.data.branch).toEqual({ connect: { id: "branch-1" } });
    expect(captured.data.tenantId).toBeUndefined();
    expect(captured.data.branchId).toBeUndefined();
  });

  it("createSlot rejects a missing branchId (branch-scope-strict)", async () => {
    await expect(
      svc.createSlot("tenant-1", { kind: "kds_screen" }),
    ).rejects.toThrow(/branchId is required/i);
    expect(prisma.device.create).not.toHaveBeenCalled();
  });

  it("createSlot rejects a branch that does not belong to the tenant", async () => {
    (prisma.branch.findFirst as any).mockResolvedValue(null);
    await expect(
      svc.createSlot("tenant-1", { kind: "kds_screen", branchId: "other" }),
    ).rejects.toThrow(/branch not found/i);
    expect(prisma.device.create).not.toHaveBeenCalled();
  });

  it("pair rejects unknown codes", async () => {
    prisma.device.findUnique.mockResolvedValue(null);
    await expect(svc.pair({ pairCode: "BADCOD" })).rejects.toThrow(
      /invalid or expired/i,
    );
  });

  it("pair rejects expired codes and clears them", async () => {
    prisma.device.findUnique.mockResolvedValue({
      id: "dev-1",
      tenantId: "t1",
      pairCode: "ABCDEF",
      pairCodeExpiresAt: new Date(Date.now() - 60_000),
    } as any);

    await expect(svc.pair({ pairCode: "ABCDEF" })).rejects.toThrow(/expired/i);
    expect(prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pairCode: null,
          pairCodeExpiresAt: null,
        }),
      }),
    );
  });

  it("pair returns a raw token that is NOT what gets stored", async () => {
    prisma.device.findUnique.mockResolvedValue({
      id: "dev-1",
      tenantId: "t1",
      pairCode: "ABCDEF",
      pairCodeExpiresAt: new Date(Date.now() + 60_000),
      kind: "kds_screen",
      branchId: null,
      capabilities: [],
      model: null,
      serial: null,
    } as any);

    const captured: any = {};
    (prisma.device.updateMany as any).mockImplementation(
      async ({ where, data }: any) => {
        Object.assign(captured, data);
        captured.__where = where;
        return { count: 1 };
      },
    );
    (prisma.device.findFirstOrThrow as any).mockImplementation(async () => ({
      id: "dev-1",
      tenantId: "t1",
      branchId: null,
      kind: "kds_screen",
      capabilities: [],
      ...captured,
    }));

    const out = await svc.pair({ pairCode: "ABCDEF" });

    // Returned token is a UUIDv7 followed by a dot and random suffix.
    expect(out.token).toMatch(/^[0-9a-f-]+\.[A-Za-z0-9_-]+$/);
    // What got stored is the sha256 hash, not the raw token.
    expect(captured.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(captured.tokenHash).not.toBe(out.token);
    // Pair code is single-use and was cleared.
    expect(captured.pairCode).toBeNull();
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: "device.paired.v1" }),
    );
  });

  /**
   * Iter-71 regression. Two devices typing the same 6-char pair code
   * milliseconds apart would both have passed findUnique → validate
   * → update, with the second writer overwriting the first's tokenHash.
   * The "winning" device thinks it paired (got a token in the response)
   * but the server has the LOSER's token stored, so the winner's
   * authenticateToken silently fails hours later when the kiosk
   * tries to heartbeat. The fix swaps the write to updateMany with
   * a (pairCode, pairCodeExpiresAt > now) predicate so Postgres's
   * single-row update atomicity serialises the writers.
   */
  it("pair refuses the second concurrent claim of the same code (count=0 → BadRequest)", async () => {
    prisma.device.findUnique.mockResolvedValue({
      id: "dev-1",
      tenantId: "t1",
      pairCode: "ABCDEF",
      pairCodeExpiresAt: new Date(Date.now() + 60_000),
      kind: "kds_screen",
      branchId: null,
      capabilities: [],
      model: null,
      serial: null,
    } as any);
    // Simulate the LOSER: the first writer already flipped pairCode to
    // NULL, so the second writer's updateMany predicate doesn't match.
    (prisma.device.updateMany as any).mockResolvedValue({ count: 0 });

    await expect(svc.pair({ pairCode: "ABCDEF" })).rejects.toThrow(
      /already claimed|expired/i,
    );
    // Critically: the loser must NOT have its outbox event fire (no
    // half-paired side-effects).
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it("pair updateMany WHERE carries the pairCode + expiry predicate (load-bearing race guard)", async () => {
    prisma.device.findUnique.mockResolvedValue({
      id: "dev-1",
      tenantId: "t1",
      pairCode: "ABCDEF",
      pairCodeExpiresAt: new Date(Date.now() + 60_000),
      kind: "kds_screen",
      branchId: null,
      capabilities: [],
      model: null,
      serial: null,
    } as any);
    let updateWhere: any = null;
    (prisma.device.updateMany as any).mockImplementation(
      async ({ where }: any) => {
        updateWhere = where;
        return { count: 1 };
      },
    );
    (prisma.device.findFirstOrThrow as any).mockResolvedValue({
      id: "dev-1",
      tenantId: "t1",
      branchId: null,
      kind: "kds_screen",
      capabilities: [],
    } as any);

    await svc.pair({ pairCode: "ABCDEF" });

    // WHERE must include the pairCode AND the expiry predicate. A
    // refactor that drops either lets the race back through.
    expect(updateWhere.pairCode).toBe("ABCDEF");
    expect(updateWhere.pairCodeExpiresAt).toEqual(
      expect.objectContaining({ gt: expect.any(Date) }),
    );
  });

  it("authenticateToken returns null when token is empty or unknown", async () => {
    expect(await svc.authenticateToken("")).toBeNull();
    prisma.device.findFirst.mockResolvedValue(null);
    expect(await svc.authenticateToken("totally-bogus")).toBeNull();
  });

  it("authenticateToken refuses expired tokens", async () => {
    prisma.device.findFirst.mockResolvedValue({
      id: "dev-1",
      tokenExpiresAt: new Date(Date.now() - 1000),
    } as any);
    expect(await svc.authenticateToken("any")).toBeNull();
  });
});

/**
 * heartbeat() flips the device to `online`, bumps lastSeenAt, and (when the
 * payload carries telemetry) writes a deviceLog row stamped with the device's
 * own tenantId. The deviceLog.create call is inline Prisma — mockable here —
 * so these assertions prove the path is testable rather than e2e-only.
 */
describe("DeviceService heartbeat", () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: DeviceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue("outbox-id") };
    svc = new DeviceService(prisma as any, outbox as any, makeConfig());
  });

  it("flips device to online and bumps lastSeenAt with no telemetry log on empty payload", async () => {
    (prisma.device.update as any).mockResolvedValue({});

    const out = await svc.heartbeat("dev-1", {});

    // The status/lastSeenAt update WHERE targets the device id and the
    // data sets status=online with a fresh lastSeenAt.
    const updateArg = (prisma.device.update as any).mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "dev-1" });
    expect(updateArg.data.status).toBe("online");
    expect(updateArg.data.lastSeenAt).toBeInstanceOf(Date);

    // REGRESSION LOCK: every heartbeat must slide tokenExpiresAt forward by
    // the full token TTL (default 24h). Without the slide an
    // actively-heartbeating fleet hard-fails authenticateToken() a day after
    // pairing and every KDS/POS/printer needs a manual re-pair.
    const slid = updateArg.data.tokenExpiresAt;
    expect(slid).toBeInstanceOf(Date);
    const expectedTtlMs = 24 * 3600 * 1000;
    const delta = slid.getTime() - Date.now();
    expect(delta).toBeGreaterThan(expectedTtlMs - 60_000);
    expect(delta).toBeLessThanOrEqual(expectedTtlMs + 60_000);

    // Empty payload => no deviceLog row written.
    expect((prisma.deviceLog.create as any).mock.calls.length).toBe(0);

    // Response echoes ok + an ISO timestamp.
    expect(out.ok).toBe(true);
    expect(out.ts).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("writes a deviceLog stamped with the device own tenantId when payload has telemetry", async () => {
    (prisma.device.update as any).mockResolvedValue({});
    // The inline tenantId lookup the service does before writing the log.
    (prisma.device.findUnique as any).mockResolvedValue({
      tenantId: "tenant-xyz",
    });
    let logData: any = null;
    (prisma.deviceLog.create as any).mockImplementation(
      async ({ data }: any) => {
        logData = data;
        return { id: data.id };
      },
    );

    await svc.heartbeat("dev-1", {
      batteryPct: 88,
      queueDepth: 3,
      agentVersion: "1.2.3",
    });

    // tenantId must come from the device row, NOT from the request — a
    // device cannot forge logs against another tenant.
    expect(logData.tenantId).toBe("tenant-xyz");
    expect(logData.deviceId).toBe("dev-1");
    expect(logData.category).toBe("heartbeat");
    expect(logData.level).toBe("info");
    expect(logData.payload).toEqual({
      batteryPct: 88,
      queueDepth: 3,
      agentVersion: "1.2.3",
    });
    // tenantId lookup selects only tenantId — defense against over-fetch.
    const findArg = (prisma.device.findUnique as any).mock.calls[0][0];
    expect(findArg.where).toEqual({ id: "dev-1" });
    expect(findArg.select).toEqual({ tenantId: true });
  });

  it("swallows a deviceLog write failure — heartbeat still succeeds", async () => {
    (prisma.device.update as any).mockResolvedValue({});
    (prisma.device.findUnique as any).mockResolvedValue({ tenantId: "t1" });
    (prisma.deviceLog.create as any).mockRejectedValue(
      new Error("log table down"),
    );

    // The .catch(() => undefined) on the deviceLog write means a logging
    // outage must not break the device's liveness signal.
    const out = await svc.heartbeat("dev-1", { batteryPct: 10 });
    expect(out.ok).toBe(true);
  });
});

/**
 * sweepStale() flips online devices whose lastSeenAt is older than the 45s
 * grace window to offline. The cutoff math is the load-bearing bit: a device
 * exactly at the boundary must stay online; only strictly-older rows match.
 */
describe("DeviceService sweepStale", () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: DeviceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue("outbox-id") };
    svc = new DeviceService(prisma as any, outbox as any, makeConfig());
  });

  it("updates only online devices older than the 45s grace window and returns the count", async () => {
    let whereArg: any = null;
    let dataArg: any = null;
    (prisma.device.updateMany as any).mockImplementation(
      async ({ where, data }: any) => {
        whereArg = where;
        dataArg = data;
        return { count: 4 };
      },
    );

    const before = Date.now();
    const count = await svc.sweepStale();
    const after = Date.now();

    expect(count).toBe(4);
    // Scoped to currently-online devices only.
    expect(whereArg.status).toBe("online");
    expect(dataArg).toEqual({ status: "offline" });
    // Cutoff = now - 45s. The lt bound must land inside [before-45s, after-45s].
    const cutoff = whereArg.lastSeenAt.lt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 45_000);
    expect(cutoff).toBeLessThanOrEqual(after - 45_000);
  });

  it("returns 0 when nothing is stale", async () => {
    (prisma.device.updateMany as any).mockResolvedValue({ count: 0 });
    expect(await svc.sweepStale()).toBe(0);
  });
});

describe("DeviceService slot lifecycle + tallies (branch hub)", () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: DeviceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue("o") };
    svc = new DeviceService(prisma as any, outbox as any, makeConfig());
    (prisma.branch.findFirst as any).mockResolvedValue({ id: "b1" });
  });

  it("createSlot rejects when the branch already has the max pending (unpaired) slots", async () => {
    (prisma.device.count as any).mockResolvedValue(10); // MAX_PENDING_SLOTS_PER_BRANCH
    await expect(
      svc.createSlot("t1", { kind: "kds_screen", branchId: "b1" }),
    ).rejects.toThrow(/waiting to be paired/i);
    expect(prisma.device.create).not.toHaveBeenCalled();
  });

  it("createSlot proceeds when under the pending cap", async () => {
    (prisma.device.count as any).mockResolvedValue(3);
    (prisma.device.findUnique as any).mockResolvedValue(null); // no pairCode collision
    (prisma.device.create as any).mockImplementation(async ({ data }: any) => ({
      id: "dev-1",
      branchId: "b1",
      kind: data.kind,
      status: "unprovisioned",
    }));
    const res = await svc.createSlot("t1", { kind: "kds_screen", branchId: "b1" });
    expect(res.id).toBe("dev-1");
    expect(prisma.device.create).toHaveBeenCalled();
  });

  it("pruneExpiredUnprovisioned deletes only expired unprovisioned slots", async () => {
    let whereArg: any;
    (prisma.device.deleteMany as any).mockImplementation(async ({ where }: any) => {
      whereArg = where;
      return { count: 3 };
    });
    const n = await svc.pruneExpiredUnprovisioned();
    expect(n).toBe(3);
    expect(whereArg.status).toBe("unprovisioned");
    expect(whereArg.pairCodeExpiresAt.lt).toBeInstanceOf(Date);
  });

  it("countsByBranch splits real (online/total) from pending and ignores retired", async () => {
    (prisma.device.groupBy as any).mockResolvedValue([
      { branchId: "b1", status: "online", _count: { _all: 2 } },
      { branchId: "b1", status: "offline", _count: { _all: 1 } },
      { branchId: "b1", status: "unprovisioned", _count: { _all: 4 } },
      { branchId: "b2", status: "online", _count: { _all: 1 } },
    ]);
    const out = await svc.countsByBranch("t1");
    expect(out["b1"]).toEqual({ total: 3, online: 2, pending: 4 });
    expect(out["b2"]).toEqual({ total: 1, online: 1, pending: 0 });
    // The query must exclude retired devices.
    const where = (prisma.device.groupBy as any).mock.calls[0][0].where;
    expect(where.status).toEqual({ not: "retired" });
  });

  describe("provisionPurchasedDevices (hardware → device-mesh)", () => {
    const HW_ORDER = "ho-1";

    beforeEach(() => {
      // The probe + create loop runs inside an advisory-locked tx; run the
      // callback against the same mock client and stub the lock + key probe.
      (prisma.$transaction as any).mockImplementation((arg: any) =>
        typeof arg === "function" ? arg(prisma) : Promise.all(arg),
      );
      (prisma.$executeRaw as any).mockResolvedValue(0);
      (prisma.device.findMany as any).mockResolvedValue([]); // no units yet
    });

    /** Common arrange: order not yet provisioned; explicit branch resolves. */
    function notYetProvisioned() {
      (prisma.device.findMany as any).mockResolvedValue([]);
    }

    it("creates one slot per unit for device-class lines and skips peripherals/services", async () => {
      notYetProvisioned();
      (prisma.branch.findFirst as any).mockResolvedValue({ id: "b1" });
      const create = jest
        .spyOn(svc, "createSlot")
        .mockResolvedValue({ id: "x" } as any);

      const created = await svc.provisionPurchasedDevices("t1", "b1", HW_ORDER, [
        { productId: "p-kds", sku: "KDS-1", qty: 2, category: "kds_screen" },
        { productId: "p-prn", sku: "PRN-1", qty: 1, category: "printer" },
        { productId: "p-cash", sku: "CASH-1", qty: 1, category: "cash_drawer" },
        { productId: "p-svc", sku: "SVC-1", qty: 1, category: "service" },
        { productId: "p-other", sku: "OTH-1", qty: 3, category: "other" },
      ]);

      // 2 KDS + 1 printer = 3; cash_drawer / service / other are skipped.
      expect(created).toBe(3);
      expect(create).toHaveBeenCalledTimes(3);
      const kinds = create.mock.calls.map((c) => (c[1] as any).kind);
      expect(kinds).toEqual(["kds_screen", "kds_screen", "receipt_printer"]);
    });

    it("passes skipPendingCap + ownership 'sold' + traceable config to createSlot", async () => {
      notYetProvisioned();
      (prisma.branch.findFirst as any).mockResolvedValue({ id: "b1" });
      const create = jest
        .spyOn(svc, "createSlot")
        .mockResolvedValue({ id: "x" } as any);

      await svc.provisionPurchasedDevices("t1", "b1", HW_ORDER, [
        { productId: "p-pos", sku: "POS-1", qty: 1, category: "pos_terminal" },
      ]);

      const arg = create.mock.calls[0][1] as any;
      expect(arg.skipPendingCap).toBe(true);
      expect(arg.ownership).toBe("sold");
      expect(arg.branchId).toBe("b1");
      expect(arg.config.hardwareOrderId).toBe(HW_ORDER);
      expect(arg.config.sku).toBe("POS-1");
      expect(arg.config.productId).toBe("p-pos");
      // Stable per-unit key (orderId:productId:unitIndex) for idempotent replay.
      expect(arg.config.provisionKey).toBe(`${HW_ORDER}:p-pos:0`);
    });

    it("is idempotent: skips units whose provisionKey already exists", async () => {
      (prisma.branch.findFirst as any).mockResolvedValue({ id: "b1" });
      // 2 of the 3 KDS units already provisioned by a prior run.
      (prisma.device.findMany as any).mockResolvedValue([
        { config: { provisionKey: `${HW_ORDER}:p-kds:0` } },
        { config: { provisionKey: `${HW_ORDER}:p-kds:1` } },
      ]);
      const create = jest
        .spyOn(svc, "createSlot")
        .mockResolvedValue({ id: "x" } as any);

      const created = await svc.provisionPurchasedDevices(
        "t1",
        "b1",
        HW_ORDER,
        [{ productId: "p-kds", sku: "KDS-1", qty: 3, category: "kds_screen" }],
      );

      // Only the missing 3rd unit is created.
      expect(created).toBe(1);
      expect(create).toHaveBeenCalledTimes(1);
      expect((create.mock.calls[0][1] as any).config.provisionKey).toBe(
        `${HW_ORDER}:p-kds:2`,
      );
      // The probe filters by the order id on the config JSON path.
      const where = (prisma.device.findMany as any).mock.calls[0][0].where;
      expect(where.config).toEqual({
        path: ["hardwareOrderId"],
        equals: HW_ORDER,
      });
    });

    it("fully no-ops when every unit is already provisioned", async () => {
      (prisma.branch.findFirst as any).mockResolvedValue({ id: "b1" });
      (prisma.device.findMany as any).mockResolvedValue([
        { config: { provisionKey: `${HW_ORDER}:p-kds:0` } },
        { config: { provisionKey: `${HW_ORDER}:p-kds:1` } },
      ]);
      const create = jest.spyOn(svc, "createSlot");
      const created = await svc.provisionPurchasedDevices("t1", "b1", HW_ORDER, [
        { productId: "p-kds", sku: "KDS-1", qty: 2, category: "kds_screen" },
      ]);
      expect(created).toBe(0);
      expect(create).not.toHaveBeenCalled();
    });

    it("returns 0 without opening a tx when nothing is provisionable", async () => {
      const create = jest.spyOn(svc, "createSlot");
      const created = await svc.provisionPurchasedDevices("t1", "b1", HW_ORDER, [
        { productId: "p-svc", sku: "SVC-1", qty: 1, category: "service" },
      ]);
      expect(created).toBe(0);
      expect(create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("resolves branch: explicit active wins over HQ", async () => {
      notYetProvisioned();
      const create = jest
        .spyOn(svc, "createSlot")
        .mockResolvedValue({ id: "x" } as any);
      (prisma.branch.findFirst as any).mockImplementation(async ({ where }: any) => {
        if (where.id === "explicit") return { id: "explicit" };
        return { id: "should-not-be-used" };
      });

      await svc.provisionPurchasedDevices("t1", "explicit", HW_ORDER, [
        { productId: "p-kds", sku: "KDS-1", qty: 1, category: "kds_screen" },
      ]);
      expect((create.mock.calls[0][1] as any).branchId).toBe("explicit");
    });

    it("resolves branch: falls back to HQ when the explicit branch is gone", async () => {
      notYetProvisioned();
      const create = jest
        .spyOn(svc, "createSlot")
        .mockResolvedValue({ id: "x" } as any);
      (prisma.branch.findFirst as any).mockImplementation(async ({ where }: any) => {
        if (where.id) return null; // explicit branch missing/inactive
        if (where.isHeadquarters === true) return { id: "hq" };
        return { id: "earliest" };
      });

      await svc.provisionPurchasedDevices("t1", "explicit", HW_ORDER, [
        { productId: "p-kds", sku: "KDS-1", qty: 1, category: "kds_screen" },
      ]);
      expect((create.mock.calls[0][1] as any).branchId).toBe("hq");
    });

    it("resolves branch: falls back to earliest active when no HQ and no explicit", async () => {
      notYetProvisioned();
      const create = jest
        .spyOn(svc, "createSlot")
        .mockResolvedValue({ id: "x" } as any);
      (prisma.branch.findFirst as any).mockImplementation(async ({ where }: any) => {
        if (where.isHeadquarters === true) return null;
        return { id: "earliest" };
      });

      await svc.provisionPurchasedDevices("t1", null, HW_ORDER, [
        { productId: "p-kds", sku: "KDS-1", qty: 1, category: "kds_screen" },
      ]);
      expect((create.mock.calls[0][1] as any).branchId).toBe("earliest");
    });

    it("returns 0 and creates nothing when the tenant has no active branch", async () => {
      notYetProvisioned();
      (prisma.branch.findFirst as any).mockResolvedValue(null);
      const create = jest.spyOn(svc, "createSlot");

      const created = await svc.provisionPurchasedDevices("t1", null, HW_ORDER, [
        { productId: "p-kds", sku: "KDS-1", qty: 1, category: "kds_screen" },
      ]);
      expect(created).toBe(0);
      expect(create).not.toHaveBeenCalled();
    });

    it("keeps going when one unit fails (best-effort; order already paid)", async () => {
      notYetProvisioned();
      (prisma.branch.findFirst as any).mockResolvedValue({ id: "b1" });
      const create = jest
        .spyOn(svc, "createSlot")
        .mockRejectedValueOnce(new Error("pair-code exhaustion"))
        .mockResolvedValue({ id: "ok" } as any);

      const created = await svc.provisionPurchasedDevices("t1", "b1", HW_ORDER, [
        { productId: "p-kds", sku: "KDS-1", qty: 3, category: "kds_screen" },
      ]);
      // First unit throws, other two succeed.
      expect(created).toBe(2);
      expect(create).toHaveBeenCalledTimes(3);
    });
  });
});

/**
 * assignBridge() is the only writer of Device.bridgeId (the topology
 * parent-link the branch hub + claimNextForBridge fan-in key on). These
 * specs lock the guards: tenant ownership, branch-scope 404, same-branch
 * bridge requirement, retired-bridge rejection, and null-detach.
 */
describe("DeviceService assignBridge", () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: DeviceService;

  const DEVICE = { id: "dev-1", tenantId: "t1", branchId: "b1" };

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue("outbox-id") };
    svc = new DeviceService(prisma as any, outbox as any, makeConfig());
    (prisma.device.findFirst as any).mockResolvedValue(DEVICE);
    (prisma.device.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.device.findFirstOrThrow as any).mockResolvedValue({
      ...DEVICE,
      bridgeId: "br-1",
    });
  });

  it("attaches the device to a same-branch bridge (tenant-fenced write)", async () => {
    (prisma.localBridgeAgent.findFirst as any).mockResolvedValue({
      id: "br-1",
      branchId: "b1",
      status: "online",
    });

    const out = await svc.assignBridge("t1", "dev-1", "br-1");

    // Bridge lookup is tenant-fenced.
    expect(
      (prisma.localBridgeAgent.findFirst as any).mock.calls[0][0].where,
    ).toEqual({ id: "br-1", tenantId: "t1" });
    // Write carries the compound tenant WHERE (B41-B45 pattern).
    const write = (prisma.device.updateMany as any).mock.calls[0][0];
    expect(write.where).toEqual({ id: "dev-1", tenantId: "t1" });
    expect(write.data).toEqual({ bridgeId: "br-1" });
    expect(out.bridgeId).toBe("br-1");
  });

  it("detaches back to cloud-direct with bridgeId=null (no bridge lookup)", async () => {
    await svc.assignBridge("t1", "dev-1", null);
    expect((prisma.localBridgeAgent.findFirst as any).mock.calls.length).toBe(
      0,
    );
    const write = (prisma.device.updateMany as any).mock.calls[0][0];
    expect(write.data).toEqual({ bridgeId: null });
  });

  it("404s when the branch scope does not match the device branch (no cross-branch probe)", async () => {
    await expect(
      svc.assignBridge("t1", "dev-1", "br-1", "OTHER-branch"),
    ).rejects.toThrow("Device not found");
    expect((prisma.device.updateMany as any).mock.calls.length).toBe(0);
  });

  it("404s on an unknown or cross-tenant bridge", async () => {
    (prisma.localBridgeAgent.findFirst as any).mockResolvedValue(null);
    await expect(svc.assignBridge("t1", "dev-1", "nope")).rejects.toThrow(
      "Bridge not found",
    );
    expect((prisma.device.updateMany as any).mock.calls.length).toBe(0);
  });

  it("rejects a retired bridge", async () => {
    (prisma.localBridgeAgent.findFirst as any).mockResolvedValue({
      id: "br-1",
      branchId: "b1",
      status: "retired",
    });
    await expect(svc.assignBridge("t1", "dev-1", "br-1")).rejects.toThrow(
      /retired/,
    );
    expect((prisma.device.updateMany as any).mock.calls.length).toBe(0);
  });

  it("rejects a bridge in a different branch (a bridge only serves its own LAN)", async () => {
    (prisma.localBridgeAgent.findFirst as any).mockResolvedValue({
      id: "br-1",
      branchId: "OTHER",
      status: "online",
    });
    await expect(svc.assignBridge("t1", "dev-1", "br-1")).rejects.toThrow(
      /same branch/,
    );
    expect((prisma.device.updateMany as any).mock.calls.length).toBe(0);
  });
});
