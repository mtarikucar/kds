import { InstallationConsumer } from './installation.consumer';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

describe('InstallationConsumer', () => {
  let prisma: MockPrismaClient;
  let bus: { on: jest.Mock };
  let jobs: { createForConversion: jest.Mock };
  let consumer: InstallationConsumer;

  const handle = (e: any) => (consumer as any).handle(e);

  beforeEach(() => {
    prisma = mockPrismaClient();
    bus = { on: jest.fn() };
    jobs = { createForConversion: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    consumer = new InstallationConsumer(prisma as any, bus as any, jobs as any);
  });

  it('subscribes to marketing.lead.converted.v1 on init', () => {
    consumer.onModuleInit();
    expect(bus.on).toHaveBeenCalledWith('marketing.lead.converted.v1', expect.any(Function));
  });

  it('auto-creates a job, snapshotting the lead contact/site', async () => {
    prisma.lead.findUnique.mockResolvedValue({
      contactPerson: 'Ada',
      phone: '5551112233',
      address: 'Main St',
      city: 'Istanbul',
    } as any);

    await handle({ payload: { leadId: 'l1', tenantId: 't1' } });

    expect(jobs.createForConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        leadId: 'l1',
        contactName: 'Ada',
        contactPhone: '5551112233',
        siteAddress: 'Main St',
        siteCity: 'Istanbul',
      }),
    );
  });

  it('still creates a job when the event carries no lead', async () => {
    await handle({ payload: { leadId: null, tenantId: 't1' } });
    expect(prisma.lead.findUnique).not.toHaveBeenCalled();
    expect(jobs.createForConversion).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1' }),
    );
  });

  it('swallows errors so a bad job never aborts the event bus', async () => {
    jobs.createForConversion.mockRejectedValue(new Error('db down'));
    await expect(handle({ payload: { leadId: null, tenantId: 't1' } })).resolves.toBeUndefined();
  });
});
