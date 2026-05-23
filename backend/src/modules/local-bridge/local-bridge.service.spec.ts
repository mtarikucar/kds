import { LocalBridgeService } from './local-bridge.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

describe('LocalBridgeService', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: LocalBridgeService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('ok') };
    svc = new LocalBridgeService(prisma as any, outbox as any);
  });

  it('createSlot rejects branches in other tenants (compound WHERE returns null)', async () => {
    // After iter-38 the service uses findFirst({where:{id, tenantId}})
    // so a cross-tenant branchId never resolves to a row.
    prisma.branch.findFirst.mockResolvedValue(null);
    await expect(svc.createSlot('t1', { branchId: 'b-1' })).rejects.toThrow(/Branch not found/);
  });

  it('createSlot returns the raw provisioning token exactly once', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: 'b-1', tenantId: 't1' } as any);
    (prisma.localBridgeAgent.create as any).mockImplementation(async ({ data }: any) => ({ id: 'lba-1', ...data }));

    const out = await svc.createSlot('t1', { branchId: 'b-1' });
    expect(out.provisioningToken).toMatch(/^[0-9a-f-]+\.[A-Za-z0-9_-]+$/);
    expect(out.bridgeId).toBe('lba-1');

    // The token stored is hashed.
    const created = (prisma.localBridgeAgent.create as any).mock.calls[0][0].data;
    expect(created.provisioningTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.provisioningTokenHash).not.toBe(out.provisioningToken);
  });

  it('claim rejects unknown / used provisioning tokens', async () => {
    // Atomic updateMany returns count=0 when nothing matched (unknown
    // token OR token already used). Service maps that to NotFound.
    (prisma.localBridgeAgent.updateMany as any).mockResolvedValue({ count: 0 });
    await expect(svc.claim({ provisioningToken: 'bogus' })).rejects.toThrow(/Invalid or already-used/);
  });

  it('claim exchanges provisioning token for a bearer + clears the provisioning token', async () => {
    let captured: any = null;
    (prisma.localBridgeAgent.updateMany as any).mockImplementation(async ({ data }: any) => {
      captured = data;
      return { count: 1 };
    });
    (prisma.localBridgeAgent.findFirstOrThrow as any).mockImplementation(async () => ({
      id: 'lba-1',
      tenantId: 't1',
      branchId: 'b-1',
      ...captured,
    }));

    const out = await svc.claim({ provisioningToken: 'whatever' });
    expect(captured.provisioningTokenHash).toBeNull();   // single-use
    expect(captured.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(captured.status).toBe('online');
    expect(out.token).toMatch(/^[0-9a-f-]+\.[A-Za-z0-9_-]+$/);
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bridge.provisioned.v1' }),
    );
  });

  it('authenticateToken rejects expired tokens', async () => {
    prisma.localBridgeAgent.findFirst.mockResolvedValue({
      id: 'lba-1', tokenExpiresAt: new Date(Date.now() - 1000),
    } as any);
    expect(await svc.authenticateToken('any')).toBeNull();
  });

  // The iter-38 commit collapsed retire()'s read + manual-check + update
  // shape into one tenant-scoped updateMany. These cases pin that contract.
  it('retire rejects when the bridge belongs to a different tenant (updateMany count=0)', async () => {
    (prisma.localBridgeAgent.updateMany as any).mockResolvedValue({ count: 0 });
    await expect(svc.retire('t1', 'lba-other')).rejects.toThrow(/not found/i);
  });

  it('retire flips status to retired and clears both token hashes atomically', async () => {
    let captured: any = null;
    (prisma.localBridgeAgent.updateMany as any).mockImplementation(async ({ where, data }: any) => {
      captured = { where, data };
      return { count: 1 };
    });
    (prisma.localBridgeAgent.findFirstOrThrow as any).mockResolvedValue({
      id: 'lba-1',
      tenantId: 't1',
      status: 'retired',
      tokenHash: null,
      provisioningTokenHash: null,
    } as any);

    const out = await svc.retire('t1', 'lba-1');

    // Tenant scope is at the query layer, not in JS — this is the
    // defense-in-depth invariant iter-38 introduced.
    expect(captured.where).toEqual({ id: 'lba-1', tenantId: 't1' });
    expect(captured.data).toEqual({
      status: 'retired',
      tokenHash: null,
      provisioningTokenHash: null,
    });
    expect(out.status).toBe('retired');
    expect(out.tokenHash).toBeNull();
    expect(out.provisioningTokenHash).toBeNull();
  });
});
