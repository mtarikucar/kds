import { DeviceService } from './device.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

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
describe('DeviceService pairing', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: DeviceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('outbox-id') };
    svc = new DeviceService(prisma as any, outbox as any, makeConfig());
  });

  describe('TTL config', () => {
    const TEN_MIN_MS = 10 * 60 * 1000;

    it('pairCode TTL defaults to 10m when DEVICE_PAIR_CODE_TTL_MS is unset', async () => {
      prisma.device.findUnique.mockResolvedValue(null);
      (prisma.device.create as any).mockImplementation(async ({ data }: any) => ({ id: 'dev-1', ...data }));

      const before = Date.now();
      const out = await svc.createSlot('tenant-1', { kind: 'kds_screen' });
      const ttl = out.pairCodeExpiresAt.getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(TEN_MIN_MS - 1000);
      expect(ttl).toBeLessThanOrEqual(TEN_MIN_MS + 5000);
    });

    it('honours a DEVICE_PAIR_CODE_TTL_MS override', async () => {
      const override = 90 * 1000;
      svc = new DeviceService(
        prisma as any,
        outbox as any,
        makeConfig({ DEVICE_PAIR_CODE_TTL_MS: override }),
      );
      prisma.device.findUnique.mockResolvedValue(null);
      (prisma.device.create as any).mockImplementation(async ({ data }: any) => ({ id: 'dev-1', ...data }));

      const before = Date.now();
      const out = await svc.createSlot('tenant-1', { kind: 'kds_screen' });
      const ttl = out.pairCodeExpiresAt.getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(override - 1000);
      expect(ttl).toBeLessThanOrEqual(override + 5000);
    });
  });

  it('createSlot generates a pair code and stores it with TTL', async () => {
    prisma.device.findUnique.mockResolvedValue(null);
    // Cast through unknown because the Prisma client return type is the
    // (very deep) PrismaPromise wrapper; for these tests the resolved
    // object is all we need to assert against.
    (prisma.device.create as any).mockImplementation(async ({ data }: any) => ({
      id: 'dev-1',
      ...data,
    }));

    const out = await svc.createSlot('tenant-1', { kind: 'kds_screen' });

    expect(out.pairCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(out.pairCodeExpiresAt).toBeInstanceOf(Date);
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'device.slot_created.v1' }),
    );
  });

  it('pair rejects unknown codes', async () => {
    prisma.device.findUnique.mockResolvedValue(null);
    await expect(svc.pair({ pairCode: 'BADCOD' })).rejects.toThrow(/invalid or expired/i);
  });

  it('pair rejects expired codes and clears them', async () => {
    prisma.device.findUnique.mockResolvedValue({
      id: 'dev-1',
      tenantId: 't1',
      pairCode: 'ABCDEF',
      pairCodeExpiresAt: new Date(Date.now() - 60_000),
    } as any);

    await expect(svc.pair({ pairCode: 'ABCDEF' })).rejects.toThrow(/expired/i);
    expect(prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pairCode: null, pairCodeExpiresAt: null }),
      }),
    );
  });

  it('pair returns a raw token that is NOT what gets stored', async () => {
    prisma.device.findUnique.mockResolvedValue({
      id: 'dev-1',
      tenantId: 't1',
      pairCode: 'ABCDEF',
      pairCodeExpiresAt: new Date(Date.now() + 60_000),
      kind: 'kds_screen',
      branchId: null,
      capabilities: [],
      model: null,
      serial: null,
    } as any);

    const captured: any = {};
    (prisma.device.updateMany as any).mockImplementation(async ({ where, data }: any) => {
      Object.assign(captured, data);
      captured.__where = where;
      return { count: 1 };
    });
    (prisma.device.findFirstOrThrow as any).mockImplementation(async () => ({
      id: 'dev-1',
      tenantId: 't1',
      branchId: null,
      kind: 'kds_screen',
      capabilities: [],
      ...captured,
    }));

    const out = await svc.pair({ pairCode: 'ABCDEF' });

    // Returned token is a UUIDv7 followed by a dot and random suffix.
    expect(out.token).toMatch(/^[0-9a-f-]+\.[A-Za-z0-9_-]+$/);
    // What got stored is the sha256 hash, not the raw token.
    expect(captured.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(captured.tokenHash).not.toBe(out.token);
    // Pair code is single-use and was cleared.
    expect(captured.pairCode).toBeNull();
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'device.paired.v1' }),
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
  it('pair refuses the second concurrent claim of the same code (count=0 → BadRequest)', async () => {
    prisma.device.findUnique.mockResolvedValue({
      id: 'dev-1',
      tenantId: 't1',
      pairCode: 'ABCDEF',
      pairCodeExpiresAt: new Date(Date.now() + 60_000),
      kind: 'kds_screen',
      branchId: null,
      capabilities: [],
      model: null,
      serial: null,
    } as any);
    // Simulate the LOSER: the first writer already flipped pairCode to
    // NULL, so the second writer's updateMany predicate doesn't match.
    (prisma.device.updateMany as any).mockResolvedValue({ count: 0 });

    await expect(svc.pair({ pairCode: 'ABCDEF' })).rejects.toThrow(
      /already claimed|expired/i,
    );
    // Critically: the loser must NOT have its outbox event fire (no
    // half-paired side-effects).
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('pair updateMany WHERE carries the pairCode + expiry predicate (load-bearing race guard)', async () => {
    prisma.device.findUnique.mockResolvedValue({
      id: 'dev-1',
      tenantId: 't1',
      pairCode: 'ABCDEF',
      pairCodeExpiresAt: new Date(Date.now() + 60_000),
      kind: 'kds_screen',
      branchId: null,
      capabilities: [],
      model: null,
      serial: null,
    } as any);
    let updateWhere: any = null;
    (prisma.device.updateMany as any).mockImplementation(async ({ where }: any) => {
      updateWhere = where;
      return { count: 1 };
    });
    (prisma.device.findFirstOrThrow as any).mockResolvedValue({
      id: 'dev-1', tenantId: 't1', branchId: null, kind: 'kds_screen', capabilities: [],
    } as any);

    await svc.pair({ pairCode: 'ABCDEF' });

    // WHERE must include the pairCode AND the expiry predicate. A
    // refactor that drops either lets the race back through.
    expect(updateWhere.pairCode).toBe('ABCDEF');
    expect(updateWhere.pairCodeExpiresAt).toEqual(expect.objectContaining({ gt: expect.any(Date) }));
  });

  it('authenticateToken returns null when token is empty or unknown', async () => {
    expect(await svc.authenticateToken('')).toBeNull();
    prisma.device.findFirst.mockResolvedValue(null);
    expect(await svc.authenticateToken('totally-bogus')).toBeNull();
  });

  it('authenticateToken refuses expired tokens', async () => {
    prisma.device.findFirst.mockResolvedValue({
      id: 'dev-1',
      tokenExpiresAt: new Date(Date.now() - 1000),
    } as any);
    expect(await svc.authenticateToken('any')).toBeNull();
  });
});
