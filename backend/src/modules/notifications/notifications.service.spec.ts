import { NotificationsService } from './notifications.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { NotificationType } from './dto/create-notification.dto';

/**
 * Regression spec for the iter-8 notifyAdmins fan-out race.
 *
 * The original implementation set `createdAt = new Date()` then re-fetched
 * rows by (tenantId, userId IN admins, createdAt, title). Two concurrent
 * notifyAdmins calls firing within the same millisecond with the same
 * title produced overlapping result sets — each invocation then fired
 * the WS gateway for the OTHER call's rows, doubling the broadcast per
 * admin.
 *
 * The fix generates uuidv7 ids client-side and scopes the re-fetch to
 * `id: { in: theseIds }`. The load-bearing assertion is that the
 * re-fetch's WHERE clause uses the id-list, NOT the (createdAt, title)
 * shape that allowed cross-call leakage.
 */
describe('NotificationsService.notifyAdmins (iter-8 fan-out race fix)', () => {
  let prisma: MockPrismaClient;
  let gateway: { sendNotificationToUser: jest.Mock };
  let svc: NotificationsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = { sendNotificationToUser: jest.fn() };
    svc = new NotificationsService(prisma as any, gateway as any);
  });

  it('returns [] without DB writes when the tenant has no admins/managers', async () => {
    prisma.user.findMany.mockResolvedValue([] as any);

    const out = await svc.notifyAdmins('t1', {
      title: 'T',
      message: 'M',
      type: NotificationType.INFO,
    });

    expect(out).toEqual([]);
    expect((prisma.notification.createMany as any).mock.calls.length).toBe(0);
    expect(gateway.sendNotificationToUser).not.toHaveBeenCalled();
  });

  it('generates client-side uuids and re-fetches by id IN [...] not by createdAt+title', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u-a' },
      { id: 'u-b' },
    ] as any);

    let createManyArgs: any = null;
    (prisma.notification.createMany as any).mockImplementation(async ({ data }: any) => {
      createManyArgs = data;
      return { count: data.length };
    });

    let findManyWhere: any = null;
    (prisma.notification.findMany as any).mockImplementation(async ({ where }: any) => {
      findManyWhere = where;
      // Return hydrated rows for the gateway emit.
      return (createManyArgs ?? []).map((r: any) => ({ ...r, isRead: false }));
    });

    await svc.notifyAdmins('t1', {
      title: 'Stock low',
      message: 'msg',
      type: NotificationType.WARNING,
    });

    // Load-bearing assertion #1: client-side uuids on every row.
    // UUIDv7 format: 8-4-4-4-12 lower-hex with version 7 nibble.
    expect(createManyArgs).toHaveLength(2);
    for (const row of createManyArgs) {
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }

    // Load-bearing assertion #2: the re-fetch scopes by id IN [...] and
    // NOT by the (createdAt, title, userId IN admins) shape that was the
    // pre-iter-8 race vector. If a future refactor reverts to that
    // shape, this test fails.
    const expectedIds = createManyArgs.map((r: any) => r.id);
    expect(findManyWhere).toEqual({ id: { in: expectedIds } });
    expect(findManyWhere.createdAt).toBeUndefined();
    expect(findManyWhere.title).toBeUndefined();
  });

  it('emits to the gateway exactly once per admin', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u-a' },
      { id: 'u-b' },
      { id: 'u-c' },
    ] as any);
    let captured: any[] = [];
    (prisma.notification.createMany as any).mockImplementation(async ({ data }: any) => {
      captured = data;
      return { count: data.length };
    });
    (prisma.notification.findMany as any).mockImplementation(async () => captured);

    await svc.notifyAdmins('t1', {
      title: 'X',
      message: 'Y',
      type: NotificationType.INFO,
    });

    expect(gateway.sendNotificationToUser).toHaveBeenCalledTimes(3);
    const calledUsers = gateway.sendNotificationToUser.mock.calls.map((c: any[]) => c[0]).sort();
    expect(calledUsers).toEqual(['u-a', 'u-b', 'u-c']);
  });

  it('only ACTIVE admins/managers are queried (not arbitrary users)', async () => {
    prisma.user.findMany.mockResolvedValue([] as any);
    await svc.notifyAdmins('t1', {
      title: 'T',
      message: 'M',
      type: NotificationType.INFO,
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          role: { in: ['ADMIN', 'MANAGER'] },
          status: 'ACTIVE',
        }),
      }),
    );
  });
});
