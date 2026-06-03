import { InstallationCrewService } from './installation-crew.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

describe('InstallationCrewService', () => {
  let prisma: MockPrismaClient;
  let svc: InstallationCrewService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new InstallationCrewService(prisma as any);
  });

  it('creates a crew with a default daily capacity of 1', async () => {
    prisma.installationCrew.create.mockResolvedValue({ id: 'c1' } as any);
    await svc.create({ name: 'Crew A' } as any);
    expect(prisma.installationCrew.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Crew A', dailyCapacity: 1 }),
      }),
    );
  });

  it('computes per-crew availability on a date (booked < capacity)', async () => {
    prisma.installationCrew.findMany.mockResolvedValue([
      { id: 'c1', name: 'A', dailyCapacity: 2 },
      { id: 'c2', name: 'B', dailyCapacity: 1 },
    ] as any);
    // Cast — DeepMockProxy's groupBy signature materialises Prisma's circular
    // `having` type (TS2615) on access.
    (prisma.installationJob.groupBy as any).mockResolvedValue([
      { crewId: 'c1', _count: 1 },
      { crewId: 'c2', _count: 1 },
    ]);

    const avail = await svc.availabilityOn(new Date('2026-06-10'));

    expect(avail).toEqual([
      { crew: { id: 'c1', name: 'A', dailyCapacity: 2 }, booked: 1, available: true },
      { crew: { id: 'c2', name: 'B', dailyCapacity: 1 }, booked: 1, available: false },
    ]);
  });

  it('reports a crew with no bookings as fully available', async () => {
    prisma.installationCrew.findMany.mockResolvedValue([
      { id: 'c1', name: 'A', dailyCapacity: 1 },
    ] as any);
    (prisma.installationJob.groupBy as any).mockResolvedValue([]);

    const avail = await svc.availabilityOn(new Date('2026-06-10'));

    expect(avail).toEqual([
      { crew: { id: 'c1', name: 'A', dailyCapacity: 1 }, booked: 0, available: true },
    ]);
  });
});
