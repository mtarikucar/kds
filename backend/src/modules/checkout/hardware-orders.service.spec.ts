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

/**
 * v3.7.0 — service rows (print3d) never produce HardwareOrderItem rows, so
 * a paid ₺2.000 print3d order used to come back with `items: []` and a
 * non-zero total: an empty line-item table for something the customer paid
 * for. The fix is the `print3dJob` include added to both listMine and
 * getMine — this suite proves the query actually asks for it, and that the
 * block (with its items) survives the round trip to the caller.
 */
describe('HardwareOrdersService — print3d order reads (v3.7.0)', () => {
  let prisma: {
    hardwareOrder: { findMany: jest.Mock; findFirst: jest.Mock };
  };
  let svc: HardwareOrdersService;

  // A paid print3d order exactly as Postgres would shape it once the
  // print3dJob include is present: `items` (HardwareOrderItem) is empty —
  // service-only cart, no hardware line — while print3dJob carries the two
  // figures the customer actually bought.
  const paidPrint3dOrder = {
    id: 'ho-print3d-1',
    tenantId: 't1',
    status: 'paid',
    totalCents: 200_000,
    items: [], // no HardwareOrderItem rows — service-only cart
    print3dJob: {
      id: 'job-1',
      status: 'queued',
      itemCount: 2,
      totalCents: 200_000,
      partner: 'figurunica',
      items: [
        { productName: 'Adana Kebap', productImageUrl: '/img/adana.jpg', position: 0, status: 'pending' },
        { productName: 'Silinmiş ürün', productImageUrl: null, position: 1, status: 'pending' },
      ],
    },
  };

  beforeEach(() => {
    prisma = {
      hardwareOrder: {
        findMany: jest.fn().mockResolvedValue([paidPrint3dOrder]),
        findFirst: jest.fn().mockResolvedValue(paidPrint3dOrder),
      },
    };
    svc = new HardwareOrdersService(prisma as any);
  });

  it('listMine asks Prisma for the print3dJob block (id, status, itemCount, totalCents, partner, items)', async () => {
    await svc.listMine('t1');
    const include = prisma.hardwareOrder.findMany.mock.calls[0][0].include;
    expect(include.print3dJob).toEqual(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          status: true,
          itemCount: true,
          totalCents: true,
          partner: true,
          items: expect.objectContaining({
            select: expect.objectContaining({
              productName: true,
              productImageUrl: true,
              position: true,
              status: true,
            }),
          }),
        }),
      }),
    );
  });

  it('getMine asks Prisma for the print3dJob block', async () => {
    await svc.getMine('t1', 'ho-print3d-1');
    const include = prisma.hardwareOrder.findFirst.mock.calls[0][0].include;
    expect(include.print3dJob).toBeDefined();
    expect(include.print3dJob.select.items.select).toEqual(
      expect.objectContaining({ productName: true }),
    );
  });

  it('listMine surfaces a paid print3d order with its item lines, not an empty table', async () => {
    const [order] = await svc.listMine('t1');
    expect(order.items).toEqual([]); // the generic reader really is empty
    expect(order.print3dJob).toBeDefined();
    expect(order.print3dJob.items.length).toBeGreaterThan(0);
    expect(order.print3dJob.items[0].productName).toBe('Adana Kebap');
  });

  it('getMine surfaces a paid print3d order with its item lines, not an empty table', async () => {
    const order = await svc.getMine('t1', 'ho-print3d-1');
    expect(order.items).toEqual([]);
    expect(order.print3dJob.itemCount).toBe(2);
    expect(order.print3dJob.items).toHaveLength(2);
  });
});
