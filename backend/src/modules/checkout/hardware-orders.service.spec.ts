import { NotFoundException } from '@nestjs/common';
import { HardwareOrdersService } from './hardware-orders.service';

/**
 * Spec for the read-only HardwareOrdersService. Verifies tenant scoping, the
 * optional status filter on listMine, the 100-row cap / desc ordering, and the
 * not-found throw in getMine.
 */
describe('HardwareOrdersService', () => {
  let prisma: { hardwareOrder: { findMany: jest.Mock; findFirst: jest.Mock } };
  let svc: HardwareOrdersService;

  beforeEach(() => {
    prisma = {
      hardwareOrder: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
    };
    svc = new HardwareOrdersService(prisma as any);
  });

  it('listMine scopes by tenantId, caps at 100, orders desc', async () => {
    await svc.listMine('t1');
    const arg = prisma.hardwareOrder.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ tenantId: 't1' });
    expect(arg.take).toBe(100);
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('listMine adds the status filter only when provided', async () => {
    await svc.listMine('t1', 'shipped');
    expect(prisma.hardwareOrder.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      status: 'shipped',
    });
  });

  it('listMine omits status when not provided (no undefined leak)', async () => {
    await svc.listMine('t1');
    expect(prisma.hardwareOrder.findMany.mock.calls[0][0].where).not.toHaveProperty('status');
  });

  it('getMine returns the row when found (scoped by id + tenantId)', async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue({ id: 'o1' });
    await expect(svc.getMine('t1', 'o1')).resolves.toEqual({ id: 'o1' });
    expect(prisma.hardwareOrder.findFirst.mock.calls[0][0].where).toEqual({
      id: 'o1',
      tenantId: 't1',
    });
  });

  it('getMine throws NotFound when the row is missing', async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue(null);
    await expect(svc.getMine('t1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
