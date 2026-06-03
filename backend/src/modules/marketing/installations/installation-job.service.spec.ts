import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InstallationJobService } from './installation-job.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

describe('InstallationJobService', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: InstallationJobService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('ob') };
    svc = new InstallationJobService(prisma as any, outbox as any);
    (prisma.$transaction as any).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    );
  });

  describe('createForConversion', () => {
    it('is idempotent — returns the existing non-cancelled job', async () => {
      prisma.installationJob.findFirst.mockResolvedValue({ id: 'job-existing' } as any);
      const res = await svc.createForConversion({ tenantId: 't1', leadId: 'l1' });
      expect(res).toEqual({ id: 'job-existing' });
      expect(prisma.installationJob.create).not.toHaveBeenCalled();
    });

    it('creates a REQUESTED job, snapshotting the contact/site', async () => {
      prisma.installationJob.findFirst.mockResolvedValue(null);
      prisma.installationJob.create.mockResolvedValue({ id: 'job-new' } as any);
      await svc.createForConversion({
        tenantId: 't1',
        leadId: 'l1',
        contactName: 'Ada',
        siteCity: 'Istanbul',
      });
      expect(prisma.installationJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't1',
            leadId: 'l1',
            status: 'REQUESTED',
            contactName: 'Ada',
            siteCity: 'Istanbul',
          }),
        }),
      );
    });
  });

  describe('schedule', () => {
    beforeEach(() => {
      prisma.installationJob.findUnique.mockResolvedValue({
        id: 'job-1',
        tenantId: 't1',
        status: 'REQUESTED',
      } as any);
      prisma.installationCrew.findUnique.mockResolvedValue({
        id: 'crew-1',
        active: true,
        dailyCapacity: 1,
      } as any);
      prisma.installationJob.count.mockResolvedValue(0); // crew free
      prisma.installationJob.update.mockResolvedValue({ id: 'job-1', status: 'SCHEDULED' } as any);
    });

    it('assigns crew+date and emits installation.scheduled.v1', async () => {
      await svc.schedule('job-1', { crewId: 'crew-1', scheduledDate: '2026-06-10' } as any);
      expect(prisma.installationJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            crewId: 'crew-1',
            status: 'SCHEDULED',
            scheduledAt: expect.any(Date),
          }),
        }),
      );
      expect(outbox.append.mock.calls[0][0]).toMatchObject({
        type: 'marketing.installation.scheduled.v1',
      });
    });

    it('rejects when the crew is fully booked on that date', async () => {
      prisma.installationJob.count.mockResolvedValue(1); // == capacity
      await expect(
        svc.schedule('job-1', { crewId: 'crew-1', scheduledDate: '2026-06-10' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects scheduling a DONE job', async () => {
      prisma.installationJob.findUnique.mockResolvedValue({
        id: 'job-1',
        tenantId: 't1',
        status: 'DONE',
      } as any);
      await expect(
        svc.schedule('job-1', { crewId: 'crew-1', scheduledDate: '2026-06-10' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an inactive crew', async () => {
      prisma.installationCrew.findUnique.mockResolvedValue({
        id: 'crew-1',
        active: false,
        dailyCapacity: 1,
      } as any);
      await expect(
        svc.schedule('job-1', { crewId: 'crew-1', scheduledDate: '2026-06-10' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('setStatus', () => {
    it('moves SCHEDULED → IN_PROGRESS and stamps startedAt', async () => {
      prisma.installationJob.findUnique.mockResolvedValue({
        id: 'job-1',
        tenantId: 't1',
        status: 'SCHEDULED',
        crewId: 'crew-1',
      } as any);
      prisma.installationJob.update.mockResolvedValue({ id: 'job-1', status: 'IN_PROGRESS' } as any);
      await svc.setStatus('job-1', 'IN_PROGRESS');
      expect(prisma.installationJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'IN_PROGRESS', startedAt: expect.any(Date) }),
        }),
      );
    });

    it('emits installation.completed.v1 on DONE', async () => {
      prisma.installationJob.findUnique.mockResolvedValue({
        id: 'job-1',
        tenantId: 't1',
        status: 'IN_PROGRESS',
        crewId: 'crew-1',
      } as any);
      prisma.installationJob.update.mockResolvedValue({ id: 'job-1', status: 'DONE' } as any);
      await svc.setStatus('job-1', 'DONE');
      expect(outbox.append.mock.calls[0][0]).toMatchObject({
        type: 'marketing.installation.completed.v1',
      });
    });

    it('rejects an illegal transition (REQUESTED → DONE)', async () => {
      prisma.installationJob.findUnique.mockResolvedValue({
        id: 'job-1',
        tenantId: 't1',
        status: 'REQUESTED',
      } as any);
      await expect(svc.setStatus('job-1', 'DONE')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('tasks', () => {
    it('appends a task at the next position', async () => {
      prisma.installationJob.findUnique.mockResolvedValue({ id: 'job-1', status: 'REQUESTED' } as any);
      prisma.installationTask.count.mockResolvedValue(2);
      prisma.installationTask.create.mockResolvedValue({ id: 'task-1' } as any);
      await svc.addTask('job-1', { title: 'Mount printer' } as any);
      expect(prisma.installationTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ jobId: 'job-1', title: 'Mount printer', position: 2 }),
        }),
      );
    });

    it('toggles a task done flag', async () => {
      prisma.installationTask.findUnique.mockResolvedValue({
        id: 'task-1',
        jobId: 'job-1',
        done: false,
      } as any);
      prisma.installationTask.update.mockResolvedValue({ id: 'task-1', done: true } as any);
      await svc.toggleTask('job-1', 'task-1');
      expect(prisma.installationTask.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { done: true } }),
      );
    });

    it('rejects a task that belongs to another job', async () => {
      prisma.installationTask.findUnique.mockResolvedValue({
        id: 'task-1',
        jobId: 'other',
        done: false,
      } as any);
      await expect(svc.toggleTask('job-1', 'task-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('dashboard', () => {
    it('aggregates status counts, backlog, SLA breaches, and upcoming', async () => {
      // Cast to a plain mock — DeepMockProxy's typed groupBy signature
      // materialises Prisma 6's circular `having` type (TS2615) on access.
      (prisma.installationJob.groupBy as any).mockResolvedValue([
        { status: 'REQUESTED', _count: { _all: 3 } },
        { status: 'SCHEDULED', _count: { _all: 2 } },
      ]);
      (prisma.$transaction as any).mockResolvedValueOnce([3, 1, [{ id: 'job-up' }]]);
      const d = await svc.dashboard();
      expect(d.byStatus).toEqual({ REQUESTED: 3, SCHEDULED: 2 });
      expect(d.unscheduled).toBe(3);
      expect(d.overdueSla).toBe(1);
      expect(d.upcoming).toEqual([{ id: 'job-up' }]);
    });
  });
});
