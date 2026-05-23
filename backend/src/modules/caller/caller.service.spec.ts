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
});
