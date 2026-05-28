import { NotFoundException } from '@nestjs/common';
import { CallerService } from './caller.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

describe('CallerService.ingest', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: CallerService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('ok') };
    svc = new CallerService(prisma as any, outbox as any);
    (prisma.callerEvent.create as any).mockImplementation(async ({ data }: any) => ({ ...data }));
    // Default — tenant exists. Iter-55 NotFound case overrides this.
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
  });

  it('matches the customer by e164 when present', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'c-99' } as any);
    await svc.ingest('t1', {
      providerId: 'mock', callId: 'call-1', kind: 'incoming',
      e164: '+905551112233', occurredAt: new Date().toISOString(),
    });
    const create = (prisma.callerEvent.create as any).mock.calls[0][0].data;
    expect(create.customerId).toBe('c-99');
    expect(create.kind).toBe('incoming');
  });

  it('falls back to null customerId when no match', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    await svc.ingest('t1', {
      providerId: 'mock', callId: 'call-2', kind: 'incoming',
      e164: '+905559998877', occurredAt: new Date().toISOString(),
    });
    const create = (prisma.callerEvent.create as any).mock.calls[0][0].data;
    expect(create.customerId).toBeNull();
  });

  it('emits the kind-specific event', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    await svc.ingest('t1', {
      providerId: 'mock', callId: 'call-3', kind: 'missed',
      e164: '+905551112233', occurredAt: new Date().toISOString(),
    });
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'caller.missed.v1' }),
    );
  });

  /**
   * Iter-55 regression. The CallerEvent.tenantId column has no FK in the
   * schema, and the webhook route accepts the tenantId as a URL param
   * (the mock adapter doesn't verify the signature header). Before this
   * fix, an attacker could POST to the public mock webhook with any
   * tenant UUID — even non-existent ones — and the row would land in
   * caller_events, polluting that tenant's UI feed. The lookup gate
   * here is the defence in depth: prod refusal in the controller closes
   * the public ingress, and this throws if anything else manages to
   * reach the service with a bogus tenantId.
   */
  it('rejects unknown tenant ids with NotFound (iter-55)', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    await expect(
      svc.ingest('not-a-tenant', {
        providerId: 'mock', callId: 'call-4', kind: 'incoming',
        e164: '+905551112233', occurredAt: new Date().toISOString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Critically — no DB write fires for the bogus tenant.
    expect((prisma.callerEvent.create as any).mock.calls.length).toBe(0);
    expect(outbox.append).not.toHaveBeenCalled();
  });
});
