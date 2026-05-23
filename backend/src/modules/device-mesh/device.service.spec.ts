import { DeviceService } from './device.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

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
    svc = new DeviceService(prisma as any, outbox as any);
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
    (prisma.device.update as any).mockImplementation(async ({ data }: any) => {
      Object.assign(captured, data);
      return {
        id: 'dev-1',
        tenantId: 't1',
        branchId: null,
        kind: 'kds_screen',
        capabilities: [],
        ...data,
      };
    });

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
