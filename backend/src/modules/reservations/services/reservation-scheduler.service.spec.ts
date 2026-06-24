import { ReservationSchedulerService } from './reservation-scheduler.service';
import { ReservationStatus } from '../constants/reservation-status.enum';
import { TableStatus } from '../../tables/dto/create-table.dto';

/**
 * Spec for the hold/release logic of ReservationSchedulerService. The cron
 * wrappers just take an advisory lock and delegate; we drive the *Inner
 * methods + fetchOffsets directly with a mocked Prisma so the time-window and
 * eligibility branches are covered without scheduling/lock machinery.
 */
function makePrisma() {
  return {
    reservation: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    reservationSettings: { findMany: jest.fn().mockResolvedValue([]) },
    table: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

// Build an HH:mm string offset minutes from now (today's date row).
function hhmmFromNow(deltaMin: number): { date: Date; time: string } {
  const d = new Date();
  const t = new Date(d.getTime() + deltaMin * 60_000);
  const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  // date row is midnight-anchored like the service expects
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return { date, time };
}

describe('ReservationSchedulerService.fetchOffsets', () => {
  it('returns an empty map for no tenants (no query)', async () => {
    const prisma = makePrisma();
    const svc = new ReservationSchedulerService(prisma as any);
    const map = await (svc as any).fetchOffsets([]);
    expect(map.size).toBe(0);
    expect(prisma.reservationSettings.findMany).not.toHaveBeenCalled();
  });

  it('maps tenantId → holdOffsetMinutes for present rows', async () => {
    const prisma = makePrisma();
    prisma.reservationSettings.findMany.mockResolvedValue([
      { tenantId: 't1', holdOffsetMinutes: 45 },
    ]);
    const svc = new ReservationSchedulerService(prisma as any);
    const map = await (svc as any).fetchOffsets(['t1', 't2']);
    expect(map.get('t1')).toBe(45);
    expect(map.has('t2')).toBe(false); // absent → caller falls back to default
  });
});

describe('ReservationSchedulerService.autoHoldUpcomingInner', () => {
  it('holds an AVAILABLE table for a reservation starting inside the window', async () => {
    const prisma = makePrisma();
    const { date, time } = hhmmFromNow(10); // 10 min from now, inside default 30m window
    prisma.reservation.findMany.mockResolvedValue([
      { id: 'r1', tenantId: 't1', date, startTime: time, tableId: 'tbl1' },
    ]);
    prisma.table.updateMany.mockResolvedValue({ count: 1 });
    const svc = new ReservationSchedulerService(prisma as any);
    const res = await (svc as any).autoHoldUpcomingInner();
    expect(res.held).toBe(1);
    // only flips an AVAILABLE, unheld table
    expect(prisma.table.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 'tbl1',
      status: TableStatus.AVAILABLE,
      reservationHoldId: null,
    });
  });

  it('skips a reservation whose start is beyond the hold window', async () => {
    const prisma = makePrisma();
    const { date, time } = hhmmFromNow(120); // 2h out, beyond 30m window
    prisma.reservation.findMany.mockResolvedValue([
      { id: 'r1', tenantId: 't1', date, startTime: time, tableId: 'tbl1' },
    ]);
    const svc = new ReservationSchedulerService(prisma as any);
    const res = await (svc as any).autoHoldUpcomingInner();
    expect(res.held).toBe(0);
    expect(prisma.table.updateMany).not.toHaveBeenCalled();
  });

  it('skips a reservation whose start already passed', async () => {
    const prisma = makePrisma();
    const { date, time } = hhmmFromNow(-30); // already started
    prisma.reservation.findMany.mockResolvedValue([
      { id: 'r1', tenantId: 't1', date, startTime: time, tableId: 'tbl1' },
    ]);
    const svc = new ReservationSchedulerService(prisma as any);
    const res = await (svc as any).autoHoldUpcomingInner();
    expect(res.held).toBe(0);
  });

  it('emits floor:layout-updated once per branch for held tables (live-map recolor)', async () => {
    const prisma = makePrisma();
    const { date, time } = hhmmFromNow(10);
    prisma.reservation.findMany.mockResolvedValue([
      { id: 'r1', tenantId: 't1', branchId: 'b1', date, startTime: time, tableId: 'tbl1' },
    ]);
    prisma.table.updateMany.mockResolvedValue({ count: 1 });
    const gateway = { emitFloorLayoutUpdated: jest.fn() };
    const svc = new ReservationSchedulerService(prisma as any, gateway as any);
    await (svc as any).autoHoldUpcomingInner();
    expect(gateway.emitFloorLayoutUpdated).toHaveBeenCalledWith('t1', 'b1', {});
  });
});

describe('ReservationSchedulerService.releaseExpiredHoldsInner', () => {
  it('returns released:0 when there are no held tables', async () => {
    const prisma = makePrisma();
    prisma.table.findMany.mockResolvedValue([]);
    const svc = new ReservationSchedulerService(prisma as any);
    expect(await (svc as any).releaseExpiredHoldsInner()).toEqual({ released: 0 });
  });

  it('releases a hold whose reservation was cancelled', async () => {
    const prisma = makePrisma();
    prisma.table.findMany.mockResolvedValue([
      {
        id: 'tbl1',
        reservationHoldId: 'r1',
        reservationHold: { id: 'r1', status: ReservationStatus.CANCELLED },
      },
    ]);
    prisma.table.updateMany.mockResolvedValue({ count: 1 });
    const svc = new ReservationSchedulerService(prisma as any);
    const res = await (svc as any).releaseExpiredHoldsInner();
    expect(res.released).toBe(1);
    expect(prisma.table.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 'tbl1',
      status: TableStatus.RESERVED,
      reservationHoldId: 'r1',
    });
  });

  it('releases a dangling hold whose reservation row is gone', async () => {
    const prisma = makePrisma();
    prisma.table.findMany.mockResolvedValue([
      { id: 'tbl1', reservationHoldId: 'r1', reservationHold: null },
    ]);
    prisma.table.updateMany.mockResolvedValue({ count: 1 });
    const svc = new ReservationSchedulerService(prisma as any);
    expect((await (svc as any).releaseExpiredHoldsInner()).released).toBe(1);
  });

  it('emits floor:layout-updated once per branch for released tables (live-map recolor)', async () => {
    const prisma = makePrisma();
    prisma.table.findMany.mockResolvedValue([
      { id: 'tbl1', tenantId: 't1', branchId: 'b1', reservationHoldId: 'r1', reservationHold: { id: 'r1', status: ReservationStatus.CANCELLED } },
    ]);
    prisma.table.updateMany.mockResolvedValue({ count: 1 });
    const gateway = { emitFloorLayoutUpdated: jest.fn() };
    const svc = new ReservationSchedulerService(prisma as any, gateway as any);
    await (svc as any).releaseExpiredHoldsInner();
    expect(gateway.emitFloorLayoutUpdated).toHaveBeenCalledWith('t1', 'b1', {});
  });

  // These two cases use fake timers pinned to local noon so the HH:mm ↔
  // midnight-anchored-date math is deterministic and never crosses midnight.
  describe('with clock pinned to noon', () => {
    const TODAY = new Date(2026, 5, 14); // midnight-anchored date row
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2026, 5, 14, 12, 0, 0)); // 12:00 local
    });
    afterEach(() => jest.useRealTimers());

    it('marks a past-grace CONFIRMED reservation NO_SHOW and releases the table', async () => {
      const prisma = makePrisma();
      // start 11:00 (60 min ago > 30 grace), end 14:00 (future → "end passed"
      // branch doesn't fire first) → exercises the NO_SHOW path.
      prisma.table.findMany.mockResolvedValue([
        {
          id: 'tbl1',
          reservationHoldId: 'r1',
          reservationHold: {
            id: 'r1',
            status: ReservationStatus.CONFIRMED,
            date: TODAY,
            startTime: '11:00',
            endTime: '14:00',
          },
        },
      ]);
      prisma.table.updateMany.mockResolvedValue({ count: 1 });
      const svc = new ReservationSchedulerService(prisma as any);
      const res = await (svc as any).releaseExpiredHoldsInner();
      expect(res.released).toBe(1);
      expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'r1',
          status: { in: [ReservationStatus.CONFIRMED, ReservationStatus.PENDING] },
        },
        data: { status: ReservationStatus.NO_SHOW },
      });
    });

    it('does not release a still-active reservation inside its window/grace', async () => {
      const prisma = makePrisma();
      // start 11:55 (5 min ago, within 30m grace), end 13:30 (future).
      prisma.table.findMany.mockResolvedValue([
        {
          id: 'tbl1',
          reservationHoldId: 'r1',
          reservationHold: {
            id: 'r1',
            status: ReservationStatus.CONFIRMED,
            date: TODAY,
            startTime: '11:55',
            endTime: '13:30',
          },
        },
      ]);
      const svc = new ReservationSchedulerService(prisma as any);
      const res = await (svc as any).releaseExpiredHoldsInner();
      expect(res.released).toBe(0);
      expect(prisma.table.updateMany).not.toHaveBeenCalled();
    });
  });
});
