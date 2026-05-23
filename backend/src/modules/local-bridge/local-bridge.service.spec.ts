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

  it('createSlot rejects branches in other tenants', async () => {
    prisma.branch.findUnique.mockResolvedValue({ id: 'b-1', tenantId: 't-other' } as any);
    await expect(svc.createSlot('t1', { branchId: 'b-1' })).rejects.toThrow(/Branch not found/);
  });

  it('createSlot returns the raw provisioning token exactly once', async () => {
    prisma.branch.findUnique.mockResolvedValue({ id: 'b-1', tenantId: 't1' } as any);
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
    prisma.localBridgeAgent.findFirst.mockResolvedValue(null);
    await expect(svc.claim({ provisioningToken: 'bogus' })).rejects.toThrow(/Invalid or already-used/);
  });

  it('claim exchanges provisioning token for a bearer + clears the provisioning token', async () => {
    prisma.localBridgeAgent.findFirst.mockResolvedValue({
      id: 'lba-1', tenantId: 't1', branchId: 'b-1', status: 'claiming',
    } as any);
    let updated: any = null;
    (prisma.localBridgeAgent.update as any).mockImplementation(async ({ data }: any) => {
      updated = data;
      return { id: 'lba-1', tenantId: 't1', branchId: 'b-1', ...data };
    });

    const out = await svc.claim({ provisioningToken: 'whatever' });
    expect(updated.provisioningTokenHash).toBeNull();   // single-use
    expect(updated.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(updated.status).toBe('online');
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
});
