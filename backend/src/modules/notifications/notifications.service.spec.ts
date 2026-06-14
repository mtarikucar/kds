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
    // v3.0.0 — notifyAdmins now resolves a fallback branchId from the
    // tenant's first active branch when callers don't supply one.
    prisma.branch.findFirst.mockResolvedValue({ id: 'b-1' } as any);

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
      // v3.0.0 — Notification.branchId is NOT NULL, populated per row
      // from the resolved tenant fallback branch.
      expect(row.branchId).toBe('b-1');
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
    // v3.0.0 — branchId fallback resolution.
    prisma.branch.findFirst.mockResolvedValue({ id: 'b-1' } as any);
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

/**
 * Regression spec for iter-53 markAllAsRead.
 *
 * Previous implementation did `$transaction([upsert × N])` — one
 * round-trip per notification all sharing one open txn. For a tenant
 * with 5k legacy notifications that's 5k statements blocking inside
 * one Postgres txn. The fix swaps to a single `createMany` with
 * `skipDuplicates: true`, which the @@unique([notificationId, userId])
 * constraint on UserNotificationRead supports.
 *
 * Load-bearing assertions:
 *  1. Tenant scope on the source select is preserved (no cross-tenant
 *     mark-as-read).
 *  2. The write path is `userNotificationRead.createMany` with
 *     `skipDuplicates: true` — NOT `$transaction([...upserts])`.
 *  3. Empty notification list short-circuits without a write.
 */
describe('NotificationsService.markAllAsRead (iter-53 createMany swap)', () => {
  let prisma: MockPrismaClient;
  let gateway: { sendNotificationToUser: jest.Mock };
  let svc: NotificationsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = { sendNotificationToUser: jest.fn() };
    svc = new NotificationsService(prisma as any, gateway as any);
  });

  it('short-circuits without a write when the user has no notifications', async () => {
    prisma.notification.findMany.mockResolvedValue([] as any);

    await svc.markAllAsRead('t1', 'u1');

    expect((prisma.userNotificationRead.createMany as any).mock.calls.length).toBe(0);
    expect((prisma.$transaction as any).mock.calls.length).toBe(0);
  });

  it('scopes the source select to (tenantId, OR(userId | isGlobal))', async () => {
    prisma.notification.findMany.mockResolvedValue([{ id: 'n1' }] as any);
    (prisma.userNotificationRead.createMany as any).mockResolvedValue({ count: 1 });

    await svc.markAllAsRead('t1', 'u1');

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't1', OR: [{ userId: 'u1' }, { isGlobal: true }] },
        select: { id: true },
      }),
    );
  });

  it('uses createMany + skipDuplicates instead of $transaction upserts', async () => {
    prisma.notification.findMany.mockResolvedValue([
      { id: 'n1' },
      { id: 'n2' },
      { id: 'n3' },
    ] as any);
    (prisma.userNotificationRead.createMany as any).mockResolvedValue({ count: 3 });

    await svc.markAllAsRead('t1', 'u1');

    expect(prisma.userNotificationRead.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.userNotificationRead.createMany).toHaveBeenCalledWith({
      data: [
        { notificationId: 'n1', userId: 'u1' },
        { notificationId: 'n2', userId: 'u1' },
        { notificationId: 'n3', userId: 'u1' },
      ],
      skipDuplicates: true,
    });
    // The pre-iter-53 path used $transaction with an array of upserts —
    // this assertion locks in that we don't regress to it.
    expect((prisma.$transaction as any).mock.calls.length).toBe(0);
    expect((prisma.userNotificationRead.upsert as any).mock.calls.length).toBe(0);
  });
});

/**
 * Track 2 observability — every notification that is actually dispatched
 * bumps a Prometheus counter labeled by the developer-controlled
 * NotificationType enum and the dispatch channel (user|global|admins).
 * A Grafana panel can then show notification throughput per type/channel.
 *
 * Mirrors the merged stock_movements_total pattern: @Optional() MetricsService,
 * after the DB write, ?.-guarded so a missing collaborator can never break
 * the business write. Labels are ONLY on developer-controlled enums — never
 * user input (title/message) — so cardinality stays bounded.
 */
describe('NotificationsService metrics (notifications_sent_total)', () => {
  let prisma: MockPrismaClient;
  let gateway: {
    sendNotificationToUser: jest.Mock;
    broadcastToTenantAcrossBranches: jest.Mock;
  };
  let metrics: { incCounter: jest.Mock };
  let svc: NotificationsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = {
      sendNotificationToUser: jest.fn(),
      broadcastToTenantAcrossBranches: jest.fn(),
    };
    metrics = { incCounter: jest.fn() };
    svc = new NotificationsService(prisma as any, gateway as any, metrics as any);
    prisma.branch.findFirst.mockResolvedValue({ id: 'b-1' } as any);
  });

  it('createAndSend to a specific user records channel=user labeled by type', async () => {
    (prisma.notification.create as any).mockResolvedValue({
      id: 'n-1',
      type: NotificationType.ORDER,
      userId: 'u-1',
    });

    await svc.createAndSend({
      title: 'T',
      message: 'M',
      type: NotificationType.ORDER,
      tenantId: 't1',
      branchId: 'b-1',
      userId: 'u-1',
    } as any);

    expect(metrics.incCounter).toHaveBeenCalledWith(
      'notifications_sent_total',
      expect.any(String),
      { type: NotificationType.ORDER, channel: 'user' },
    );
  });

  it('createAndSend with isGlobal records channel=global labeled by type', async () => {
    (prisma.notification.create as any).mockResolvedValue({
      id: 'n-2',
      type: NotificationType.SYSTEM,
      isGlobal: true,
    });

    await svc.createAndSend({
      title: 'T',
      message: 'M',
      type: NotificationType.SYSTEM,
      tenantId: 't1',
      branchId: 'b-1',
      isGlobal: true,
    } as any);

    expect(metrics.incCounter).toHaveBeenCalledWith(
      'notifications_sent_total',
      expect.any(String),
      { type: NotificationType.SYSTEM, channel: 'global' },
    );
  });

  it('notifyAdmins records channel=admins labeled by type', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'u-a' }, { id: 'u-b' }] as any);
    let captured: any[] = [];
    (prisma.notification.createMany as any).mockImplementation(async ({ data }: any) => {
      captured = data;
      return { count: data.length };
    });
    (prisma.notification.findMany as any).mockImplementation(async () => captured);

    await svc.notifyAdmins('t1', {
      title: 'Stock low',
      message: 'msg',
      type: NotificationType.WARNING,
    });

    expect(metrics.incCounter).toHaveBeenCalledWith(
      'notifications_sent_total',
      expect.any(String),
      { type: NotificationType.WARNING, channel: 'admins' },
    );
  });

  it('notifyAdmins with zero admins does NOT bump the counter (nothing dispatched)', async () => {
    prisma.user.findMany.mockResolvedValue([] as any);

    await svc.notifyAdmins('t1', {
      title: 'T',
      message: 'M',
      type: NotificationType.INFO,
    });

    expect(metrics.incCounter).not.toHaveBeenCalled();
  });

  it('does not throw when no MetricsService is injected (optional dep) — createAndSend', async () => {
    const bare = new NotificationsService(prisma as any, gateway as any);
    (prisma.notification.create as any).mockResolvedValue({
      id: 'n-3',
      type: NotificationType.INFO,
      userId: 'u-1',
    });

    await expect(
      bare.createAndSend({
        title: 'T',
        message: 'M',
        type: NotificationType.INFO,
        tenantId: 't1',
        branchId: 'b-1',
        userId: 'u-1',
      } as any),
    ).resolves.toBeDefined();
  });

  it('does not throw when no MetricsService is injected (optional dep) — notifyAdmins', async () => {
    const bare = new NotificationsService(prisma as any, gateway as any);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-a' }] as any);
    let captured: any[] = [];
    (prisma.notification.createMany as any).mockImplementation(async ({ data }: any) => {
      captured = data;
      return { count: data.length };
    });
    (prisma.notification.findMany as any).mockImplementation(async () => captured);

    await expect(
      bare.notifyAdmins('t1', {
        title: 'T',
        message: 'M',
        type: NotificationType.INFO,
      }),
    ).resolves.toBeDefined();
  });
});
