import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  /**
   * Wave-C replay dedup. Webhooks are at-least-once: a provider re-delivering
   * the same (providerId, callId, kind) for a tenant must land the event
   * exactly once. The DB UNIQUE index makes that authoritative; the second
   * create throws P2002, which the service swallows as an idempotent no-op —
   * no duplicate row, and critically no second outbox emit (which would
   * double-fire the UI popup + customer matcher).
   */
  it('ingests a duplicate (providerId,callId,kind) exactly once (P2002 → no-op)', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    const ev = {
      providerId: 'twilio', callId: 'call-dup', kind: 'incoming' as const,
      e164: '+905551112233', occurredAt: new Date().toISOString(),
    };

    // First delivery succeeds.
    (prisma.callerEvent.create as any).mockResolvedValueOnce({ id: 'row-1', ...ev, tenantId: 't1' });
    const first = await svc.ingest('t1', ev);
    expect(first).not.toBeNull();
    expect(outbox.append).toHaveBeenCalledTimes(1);

    // Second (replay) delivery collides on the unique index → P2002.
    (prisma.callerEvent.create as any).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002', clientVersion: 'test',
        meta: { target: ['tenantId', 'providerId', 'callId', 'kind'] },
      }),
    );
    const second = await svc.ingest('t1', ev);

    // Idempotent: no row returned, and NO additional outbox emit.
    expect(second).toBeNull();
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-P2002 create errors', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    (prisma.callerEvent.create as any).mockRejectedValueOnce(new Error('db down'));
    await expect(
      svc.ingest('t1', {
        providerId: 'twilio', callId: 'call-x', kind: 'incoming',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('db down');
  });
});
