import { CommandQueueService } from "./command-queue.service";
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
 * CommandQueueService talks raw SQL for the atomic claim path; here we focus
 * on the idempotency-on-create branch and the ack state machine, which sit
 * on top of regular Prisma calls and are amenable to mocking.
 */
describe("CommandQueueService", () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: CommandQueueService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue("ok") };
    svc = new CommandQueueService(prisma as any, outbox as any, makeConfig());
  });

  describe("DEFAULT_TTL config", () => {
    const THIRTY_MIN_MS = 30 * 60 * 1000;

    it("defaults to 30m when DEVICE_COMMAND_TTL_MS is unset", async () => {
      prisma.device.findFirst.mockResolvedValue({
        id: "dev",
        status: "online",
        branchId: "b",
      } as any);
      let captured: any = null;
      (prisma.deviceCommand.create as any).mockImplementation(
        async ({ data }: any) => {
          captured = data;
          return { id: "c-1", ...data };
        },
      );

      const before = Date.now();
      await svc.enqueue("t", "dev", { kind: "print", payload: {} });
      const ttl = captured.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(THIRTY_MIN_MS - 1000);
      expect(ttl).toBeLessThanOrEqual(THIRTY_MIN_MS + 5000);
    });

    it("honours a DEVICE_COMMAND_TTL_MS override", async () => {
      const override = 5 * 60 * 1000;
      svc = new CommandQueueService(
        prisma as any,
        outbox as any,
        makeConfig({ DEVICE_COMMAND_TTL_MS: override }),
      );
      prisma.device.findFirst.mockResolvedValue({
        id: "dev",
        status: "online",
        branchId: "b",
      } as any);
      let captured: any = null;
      (prisma.deviceCommand.create as any).mockImplementation(
        async ({ data }: any) => {
          captured = data;
          return { id: "c-1", ...data };
        },
      );

      const before = Date.now();
      await svc.enqueue("t", "dev", { kind: "print", payload: {} });
      const ttl = captured.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(override - 1000);
      expect(ttl).toBeLessThanOrEqual(override + 5000);
    });
  });

  /**
   * claimNext atomically transitions the next queued command to `inflight`
   * via a single raw `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
   * LOCKED LIMIT 1)`. The raw SQL is a tagged template; under jest the
   * $queryRaw mock receives the template-strings array plus the
   * interpolated deviceId as a value, so we can assert BOTH that the
   * device id is bound as a parameter (not string-spliced — SQLi guard)
   * and that the lock/skip semantics are present in the SQL text.
   */
  describe("claimNext (raw atomic claim)", () => {
    it("binds deviceId as a parameter and returns the first claimed row", async () => {
      const claimed = {
        id: "cmd-1",
        tenantId: "t",
        kind: "print",
        payload: {},
        priority: 0,
        attempts: 1,
        idempotencyKey: "k",
      };
      let strings: TemplateStringsArray | null = null;
      let values: any[] = [];
      (prisma.$queryRaw as any).mockImplementation(
        async (s: TemplateStringsArray, ...v: any[]) => {
          strings = s;
          values = v;
          return [claimed];
        },
      );

      const out = await svc.claimNext("dev-42");

      expect(out).toEqual(claimed);
      // deviceId is bound as a parameter, never interpolated into the SQL.
      expect(values).toContain("dev-42");
      // The SQL carries the concurrency-safe claim shape.
      const sql = (strings as unknown as string[]).join("?");
      expect(sql).toMatch(/UPDATE "device_commands"/);
      expect(sql).toMatch(/'inflight'/);
      expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
      expect(sql).toMatch(/LIMIT 1/);
      // Only queued + non-expired rows are eligible.
      expect(sql).toMatch(/"status" = 'queued'/);
      expect(sql).toMatch(/"expiresAt" IS NULL OR "expiresAt" > NOW/);
    });

    it("returns null when the queue is empty (zero rows)", async () => {
      (prisma.$queryRaw as any).mockResolvedValue([]);
      expect(await svc.claimNext("dev-42")).toBeNull();
    });
  });

  it("enqueue dedupes on (deviceId, idempotencyKey)", async () => {
    prisma.device.findFirst.mockResolvedValue({
      id: "dev",
      status: "online",
    } as any);

    const { Prisma } = await import("@prisma/client");
    let attempt = 0;
    (prisma.deviceCommand.create as any).mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        return {
          id: "c-1",
          tenantId: "t",
          deviceId: "dev",
          kind: "print_receipt",
        };
      }
      // Real Prisma error so the `instanceof` check the service does walks
      // the dedup branch.
      throw new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        {
          code: "P2002",
          clientVersion: "6.x",
        } as any,
      );
    });
    (prisma.deviceCommand.findUnique as any).mockResolvedValue({ id: "c-1" });

    const first = await svc.enqueue("t", "dev", {
      kind: "print_receipt",
      payload: {},
      idempotencyKey: "fixed",
    });
    const second = await svc.enqueue("t", "dev", {
      kind: "print_receipt",
      payload: {},
      idempotencyKey: "fixed",
    });
    expect(first.id).toBe("c-1");
    expect(second.id).toBe("c-1");
  });

  it("ack(failed) requeues until MAX_ATTEMPTS, then marks failed", async () => {
    // iter-28: ack now uses findFirst + updateMany + findUniqueOrThrow.
    // deep-review M21: kind must be an IDEMPOTENT one here — the generic
    // retry path is only taken for safe kinds (`print_receipt` is now
    // non-retryable; side-effecting kinds are covered by their own spec).
    prisma.deviceCommand.findFirst.mockResolvedValue({
      id: "c-1",
      deviceId: "dev",
      tenantId: "t",
      status: "inflight",
      attempts: 2,
      kind: "show_order",
    } as any);
    let capturedFirst: any = null;
    (prisma.deviceCommand.updateMany as any).mockImplementation(
      async ({ data }: any) => {
        capturedFirst = data;
        return { count: 1 };
      },
    );
    (prisma.deviceCommand.findUniqueOrThrow as any).mockResolvedValue({
      id: "c-1",
      deviceId: "dev",
      tenantId: "t",
      status: "queued",
    });

    await svc.ack("dev", "c-1", { status: "failed", error: "printer offline" });
    expect(capturedFirst.status).toBe("queued");

    prisma.deviceCommand.findFirst.mockResolvedValue({
      id: "c-1",
      deviceId: "dev",
      tenantId: "t",
      status: "inflight",
      attempts: 5,
      kind: "show_order",
    } as any);
    let capturedSecond: any = null;
    (prisma.deviceCommand.updateMany as any).mockImplementation(
      async ({ data }: any) => {
        capturedSecond = data;
        return { count: 1 };
      },
    );
    (prisma.deviceCommand.findUniqueOrThrow as any).mockResolvedValue({
      id: "c-1",
      deviceId: "dev",
      tenantId: "t",
      status: "failed",
    });
    await svc.ack("dev", "c-1", { status: "failed", error: "printer offline" });
    expect(capturedSecond.status).toBe("failed");
  });

  it("ack rejects when command does not belong to the device (iter-28: scope at DB layer)", async () => {
    // The findFirst's compound WHERE now returns null when deviceId
    // doesn't match — no in-JS post-fetch comparison. A future
    // refactor that drops the WHERE clause would surface as this test
    // returning the row and the assertion below failing.
    prisma.deviceCommand.findFirst.mockResolvedValue(null);
    await expect(svc.ack("dev", "c-1", { status: "done" })).rejects.toThrow(
      /not found/i,
    );

    // Pin the compound WHERE shape so the DB-layer scope can't silently
    // regress to in-JS filtering.
    const where = (prisma.deviceCommand.findFirst as any).mock.calls[0][0]
      .where;
    expect(where).toEqual({ id: "c-1", deviceId: "dev" });
  });

  it("ack throws on concurrent transition when updateMany claims zero rows (iter-28)", async () => {
    // Inflight when read, but a sweepStuck cron raced ahead and flipped
    // it to queued/failed between read and write. The compound-WHERE
    // updateMany returns count=0; service must surface that rather
    // than silently no-op.
    prisma.deviceCommand.findFirst.mockResolvedValue({
      id: "c-1",
      deviceId: "dev",
      tenantId: "t",
      status: "inflight",
      attempts: 1,
      kind: "print_receipt",
    } as any);
    (prisma.deviceCommand.updateMany as any).mockResolvedValue({ count: 0 });

    await expect(svc.ack("dev", "c-1", { status: "done" })).rejects.toThrow(
      /concurrent/i,
    );
  });

  /**
   * Iter-72 regression. The previous sweepStuck did
   * findMany → for...await update — an N+1 round-trip pattern that
   * held the DB connection for one serialised write per stale row.
   * The new shape issues exactly two updateMany statements inside one
   * $transaction (one per attempts-vs-MAX branch) regardless of how
   * many rows are stuck.
   */
  describe("sweepStuck batching (iter-72)", () => {
    it("issues exactly two updateMany calls inside one $transaction", async () => {
      (prisma.$transaction as any).mockImplementation(async (ops: any[]) => {
        // The test mock passes through each updateMany call so we can
        // measure how many statements the service issued. In production
        // Prisma runs them in a single round-trip.
        return Promise.all(ops);
      });
      (prisma.deviceCommand.updateMany as any).mockResolvedValue({ count: 0 });

      await svc.sweepStuck();

      expect((prisma.$transaction as any).mock.calls.length).toBe(1);
      // The first $transaction call's first arg is the array of updateMany
      // prismas: requeue + fail + (deep-review M19/M21) side-effecting-fail
      // + expired-queued sweep — length must be 4 regardless of how many
      // rows are stale.
      const txArgs = (prisma.$transaction as any).mock.calls[0][0];
      expect(Array.isArray(txArgs)).toBe(true);
      expect(txArgs.length).toBe(4);
      // findMany must NOT fire — that was the N+1 starting point.
      expect((prisma.deviceCommand.findMany as any).mock.calls.length).toBe(0);
    });

    it("returns the combined requeue+fail+sideEffectFail+expired count", async () => {
      (prisma.$transaction as any).mockResolvedValue([
        { count: 3 },
        { count: 2 },
        { count: 1 },
        { count: 4 },
      ]);

      const total = await svc.sweepStuck();

      expect(total).toBe(10);
    });

    it("predicate splits on attempts vs MAX_ATTEMPTS", async () => {
      const captured: any[] = [];
      (prisma.deviceCommand.updateMany as any).mockImplementation(
        async (args: any) => {
          captured.push(args);
          return { count: 0 };
        },
      );
      (prisma.$transaction as any).mockImplementation(async (ops: any[]) =>
        Promise.all(ops),
      );

      await svc.sweepStuck();

      // First call requeues (status=queued, attempts < MAX).
      expect(captured[0].data.status).toBe("queued");
      expect(captured[0].where.attempts).toEqual({ lt: 5 });
      // deep-review M19/M21 — the requeue branch must exclude
      // side-effecting kinds so a stuck inflight charge is never put back
      // on the queue.
      expect(captured[0].where.kind).toEqual({
        notIn: expect.arrayContaining(["charge_card"]),
      });
      // Second call fails (status=failed, attempts >= MAX).
      expect(captured[1].data.status).toBe("failed");
      expect(captured[1].where.attempts).toEqual({ gte: 5 });
    });

    /**
     * deep-review M19/M21. A stuck inflight side-effecting command
     * (charge_card / fiscal_receipt / open_drawer …) must be terminated
     * in `failed` by the sweeper REGARDLESS of attempts — never put back
     * on the queue, where claimNext would redeliver it and double-charge
     * the customer. The third updateMany matches `kind: { in: [...] }`
     * with no attempts predicate and sets status=failed.
     */
    it("routes stuck inflight side-effecting kinds to failed, never requeued (M19/M21)", async () => {
      const captured: any[] = [];
      (prisma.deviceCommand.updateMany as any).mockImplementation(
        async (args: any) => {
          captured.push(args);
          return { count: 0 };
        },
      );
      (prisma.$transaction as any).mockImplementation(async (ops: any[]) =>
        Promise.all(ops),
      );

      await svc.sweepStuck();

      // Third updateMany is the side-effecting branch.
      const sideEffect = captured[2];
      expect(sideEffect.where.status).toBe("inflight");
      expect(sideEffect.where.kind).toEqual({
        in: expect.arrayContaining([
          "charge_card",
          "fiscal_receipt",
          "open_drawer",
        ]),
      });
      // No attempts predicate — failed regardless of remaining retries.
      expect(sideEffect.where.attempts).toBeUndefined();
      expect(sideEffect.data.status).toBe("failed");
      expect(sideEffect.data.error).toMatch(/side-effecting/i);
      // And the requeue branch must NOT touch these kinds.
      expect(captured[0].where.kind).toEqual({
        notIn: expect.arrayContaining([
          "charge_card",
          "fiscal_receipt",
          "open_drawer",
        ]),
      });
    });
  });

  /**
   * deep-review M21. A failed ack on a side-effecting (non-idempotent)
   * kind must terminate directly in `failed` — NOT requeue — even with
   * retries remaining. The device may already have charged the acquirer
   * and lost only the result; re-delivery double-charges.
   */
  describe("ack failed on side-effecting kinds never requeues (M21)", () => {
    it.each(["charge_card", "fiscal_receipt", "fiscal_cancel", "open_drawer"])(
      "%s goes straight to failed despite attempts < MAX",
      async (kind) => {
        prisma.deviceCommand.findFirst.mockResolvedValue({
          id: "c-1",
          deviceId: "dev",
          tenantId: "t",
          status: "inflight",
          attempts: 1,
          kind,
        } as any);
        let captured: any = null;
        (prisma.deviceCommand.updateMany as any).mockImplementation(
          async ({ data }: any) => {
            captured = data;
            return { count: 1 };
          },
        );
        (prisma.deviceCommand.findUniqueOrThrow as any).mockResolvedValue({
          id: "c-1",
          deviceId: "dev",
          tenantId: "t",
          status: "failed",
        });

        await svc.ack("dev", "c-1", { status: "failed", error: "lost result" });

        // Terminal failed, not requeued — and ackedAt is set so it won't
        // be re-swept either.
        expect(captured.status).toBe("failed");
        expect(captured.ackedAt).toBeInstanceOf(Date);
      },
    );

    /**
     * concern B-device-mesh. The no-auto-requeue guard keys on the canonical
     * underscore-form kinds. A dot-form alias (`charge.card`) is NOT
     * recognised as non-retryable — so such an alias must never be allowed to
     * reach the queue (it would bypass the guard and double-charge). That is
     * exactly why EnqueueCommandDto pins `kind` to the canonical CommandKind
     * set; this asserts both halves of the contract at the service boundary.
     */
    it("treats canonical side-effecting kinds as non-retryable but not dot-form aliases (guard contract)", () => {
      const isNonRetryable = (k: string) =>
        (CommandQueueService as any).isNonRetryableKind(k) as boolean;
      // Canonical side-effecting kinds → non-retryable (guard fires).
      for (const k of [
        "charge_card",
        "fiscal_receipt",
        "fiscal_cancel",
        "open_drawer",
        "print_receipt",
      ]) {
        expect(isNonRetryable(k)).toBe(true);
      }
      // Dot-form aliases would slip past the guard — DTO validation must
      // reject them before they ever get here.
      for (const k of ["charge.card", "open.drawer", "print.receipt"]) {
        expect(isNonRetryable(k)).toBe(false);
      }
    });

    it("still requeues an idempotent kind (print/show_order) on failed ack with retries left", async () => {
      prisma.deviceCommand.findFirst.mockResolvedValue({
        id: "c-1",
        deviceId: "dev",
        tenantId: "t",
        status: "inflight",
        attempts: 1,
        kind: "show_order",
      } as any);
      let captured: any = null;
      (prisma.deviceCommand.updateMany as any).mockImplementation(
        async ({ data }: any) => {
          captured = data;
          return { count: 1 };
        },
      );
      (prisma.deviceCommand.findUniqueOrThrow as any).mockResolvedValue({
        id: "c-1",
        deviceId: "dev",
        tenantId: "t",
        status: "queued",
      });

      await svc.ack("dev", "c-1", { status: "failed", error: "screen busy" });

      expect(captured.status).toBe("queued");
    });
  });

  /**
   * deep-review H14. enqueue() and listForDevice() accept an optional
   * branch-scope constraint. When a non-wildcard branchId is passed, the
   * device lookup is constrained to that branch so a branch-restricted
   * manager can't target a device in another branch.
   */
  describe("branch-scope constraint (H14)", () => {
    it("enqueue constrains the device lookup to the passed branchId", async () => {
      prisma.device.findFirst.mockResolvedValue(null);

      await expect(
        svc.enqueue(
          "t",
          "dev-in-branch-B",
          { kind: "show_order", payload: {} },
          "branch-A",
        ),
      ).rejects.toThrow(/not found/i);

      const where = (prisma.device.findFirst as any).mock.calls[0][0].where;
      expect(where).toEqual({
        id: "dev-in-branch-B",
        tenantId: "t",
        branchId: "branch-A",
      });
    });

    it("enqueue stays tenant-wide when no branchId is passed (ADMIN wildcard)", async () => {
      prisma.device.findFirst.mockResolvedValue({
        id: "dev",
        status: "online",
        branchId: "b",
      } as any);
      (prisma.deviceCommand.create as any).mockImplementation(
        async ({ data }: any) => ({ id: "c-1", ...data }),
      );

      await svc.enqueue("t", "dev", { kind: "show_order", payload: {} });

      const where = (prisma.device.findFirst as any).mock.calls[0][0].where;
      expect(where).toEqual({ id: "dev", tenantId: "t" });
    });

    it("listForDevice constrains the query to the passed branchId", async () => {
      (prisma.deviceCommand.findMany as any).mockResolvedValue([]);

      await svc.listForDevice("t", "dev", undefined, "branch-A");

      const where = (prisma.deviceCommand.findMany as any).mock.calls[0][0]
        .where;
      expect(where).toMatchObject({
        tenantId: "t",
        deviceId: "dev",
        branchId: "branch-A",
      });
    });
  });

  describe("bridge command fan-in", () => {
    it("claimNextForBridge returns the single claimed row or null", async () => {
      (prisma.$queryRaw as any).mockResolvedValueOnce([
        { id: "c-1", deviceId: "d-1", kind: "charge_card", payload: {} },
      ]);
      const claimed = await svc.claimNextForBridge("bridge-1");
      expect(claimed).toMatchObject({ id: "c-1", deviceId: "d-1" });

      (prisma.$queryRaw as any).mockResolvedValueOnce([]);
      expect(await svc.claimNextForBridge("bridge-1")).toBeNull();
    });

    it("ackForBridge only acks a command whose device the bridge fronts", async () => {
      // The command belongs to a device on this bridge → delegates to the
      // device-scoped ack with the resolved deviceId.
      (prisma.deviceCommand.findFirst as any).mockResolvedValue({
        deviceId: "d-1",
      });
      const ackSpy = jest
        .spyOn(svc, "ack")
        .mockResolvedValue({ id: "c-1" } as any);

      await svc.ackForBridge("bridge-1", "c-1", { status: "done" });

      // The scope predicate must constrain by the bridge relation, not trust
      // the caller — a bridge can't ack another bridge's / a cloud-direct
      // device's command.
      const where = (prisma.deviceCommand.findFirst as any).mock.calls[0][0]
        .where;
      expect(where).toMatchObject({
        id: "c-1",
        device: { bridgeId: "bridge-1" },
      });
      expect(ackSpy).toHaveBeenCalledWith("d-1", "c-1", { status: "done" });
    });

    it("ackForBridge rejects a command not fronted by the bridge", async () => {
      (prisma.deviceCommand.findFirst as any).mockResolvedValue(null);
      const ackSpy = jest.spyOn(svc, "ack");
      await expect(
        svc.ackForBridge("bridge-1", "c-x", { status: "done" }),
      ).rejects.toThrow("Command not found for this bridge");
      expect(ackSpy).not.toHaveBeenCalled();
    });
  });
});
