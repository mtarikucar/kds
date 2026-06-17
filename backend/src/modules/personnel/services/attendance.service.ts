import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { KdsGateway } from "../../kds/kds.gateway";
import { AttendanceStatus } from "../constants/personnel.enum";
import {
  AttendanceQueryDto,
  AttendanceSummaryQueryDto,
} from "../dto/attendance-query.dto";
import { paginated } from "../../../common/pagination";
import { getTenantMidnight } from "../../../common/helpers/timezone.helper";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private kdsGateway: KdsGateway,
  ) {}

  /**
   * Resolve the tenant-local calendar day for "today" as a date-only
   * value anchored at UTC-midnight (YYYY-MM-DDT00:00:00Z).
   *
   * deep-review H6/M7: the `date` columns on Attendance and
   * ShiftAssignment are `@db.Date`, which truncates the stored instant
   * to its UTC calendar date. The previous implementation stamped the
   * `getTenantMidnight` *instant* (e.g. Istanbul 2026-06-17 00:00 =
   * 2026-06-16T21:00Z) which `@db.Date`-truncates to the PREVIOUS day
   * for every positive-offset tenant (TR is UTC+3, the primary market).
   * That stored the row one day early AND broke the clockIn ->
   * shiftAssignment join (schedule.service writes its `@db.Date` from
   * `new Date(dto.date)` which truncates to the true calendar day), so
   * isLate / lateMinutes / overtimeMinutes were silently always 0.
   *
   * By anchoring the tenant-local YYYY-MM-DD at UTC-midnight, the
   * `@db.Date` truncation yields exactly the tenant's real calendar day
   * and the round-trip stays symmetric with the schedule writer.
   */
  private async tenantTimezone(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return tenant?.timezone || "UTC";
  }

  /**
   * Tenant-local calendar day for `now`, anchored at UTC-midnight so the
   * `@db.Date` column stores the tenant's actual day (deep-review H6/M7).
   */
  private tenantDateOnly(now: Date, timezone: string): Date {
    try {
      const ymd = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
      return new Date(`${ymd}T00:00:00.000Z`);
    } catch {
      // Unknown tz: fall back to the server-local calendar day at
      // UTC-midnight (still date-only correct on a UTC container).
      const fallback = new Date(
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
      );
      return fallback;
    }
  }

  /**
   * The UTC instant for a tenant-local wall-clock HH:MM on the calendar
   * day represented by `dateOnly` (a UTC-anchored date-only value).
   *
   * deep-review H6 (secondary): shift template start/end times are
   * tenant-local wall clock ("09:00"). The old code built shiftStart via
   * `new Date(today); setHours(...)` using SERVER-local hours, so even
   * once the join matched the late/grace comparison was tz-skewed. We
   * anchor on the tenant midnight (via the shared helper, DST-safe) and
   * add the wall-clock offset.
   */
  private tenantWallClockInstant(
    dateOnly: Date,
    hour: number,
    minute: number,
    timezone: string,
  ): Date {
    // Anchor at noon so a DST jump (which happens at night) cannot push
    // getTenantMidnight onto the adjacent day — mirrors getTenantDayBounds.
    const noonUtc = new Date(dateOnly.getTime() + 12 * 60 * 60 * 1000);
    const midnight = getTenantMidnight(noonUtc, timezone);
    return new Date(midnight.getTime() + (hour * 60 + minute) * 60000);
  }

  async clockIn(tenantId: string, userId: string, notes?: string) {
    const timezone = await this.tenantTimezone(tenantId);
    const today = this.tenantDateOnly(new Date(), timezone);

    // Check no existing active record for today
    const existing = await this.prisma.attendance.findFirst({
      where: { userId, date: today, tenantId },
    });

    if (existing && existing.status !== AttendanceStatus.CLOCKED_OUT) {
      throw new BadRequestException("Already clocked in today");
    }

    if (existing && existing.status === AttendanceStatus.CLOCKED_OUT) {
      throw new BadRequestException(
        "Already clocked out today. Cannot clock in again.",
      );
    }

    // Find shift assignment for today
    const shiftAssignment = await this.prisma.shiftAssignment.findFirst({
      where: { userId, date: today, tenantId },
      include: { shiftTemplate: true },
    });

    let isLate = false;
    let lateMinutes = 0;
    const now = new Date();

    if (shiftAssignment?.shiftTemplate) {
      const [shiftHour, shiftMin] = shiftAssignment.shiftTemplate.startTime
        .split(":")
        .map(Number);
      const gracePeriod = shiftAssignment.shiftTemplate.gracePeriodMinutes;

      // deep-review H6: build shiftStart in the TENANT timezone, not
      // server-local, so isLate/lateMinutes are accurate on a UTC pod.
      const shiftStart = this.tenantWallClockInstant(
        today,
        shiftHour,
        shiftMin,
        timezone,
      );

      const graceEnd = new Date(shiftStart.getTime() + gracePeriod * 60000);

      if (now > graceEnd) {
        isLate = true;
        lateMinutes = Math.floor(
          (now.getTime() - shiftStart.getTime()) / 60000,
        );
      }
    }

    // v3.0.0: every operational row carries a branchId. For attendance,
    // the row belongs to the user's primary branch — payroll/scheduling
    // joins are per-branch, so writing it tenant-wide would break the
    // branch-scoped views. Falls back to the shift assignment's branch
    // when the user has no primaryBranchId yet (e.g. fresh onboarding).
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { primaryBranchId: true },
    });
    const branchId = user?.primaryBranchId ?? shiftAssignment?.branchId;
    if (!branchId) {
      throw new BadRequestException(
        "Cannot clock in: user has no primary branch assigned",
      );
    }

    try {
      const result = await this.prisma.attendance.create({
        data: {
          date: today,
          clockIn: now,
          status: AttendanceStatus.CLOCKED_IN,
          isLate,
          lateMinutes,
          notes,
          shiftAssignmentId: shiftAssignment?.id,
          userId,
          tenantId,
          branchId,
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, role: true },
          },
        },
      });

      this.kdsGateway.emitAttendanceUpdate(tenantId, result.branchId, result);
      return result;
    } catch (error: any) {
      // Handle unique constraint violation (concurrent clock-in)
      if (error.code === "P2002") {
        throw new BadRequestException("Already clocked in today");
      }
      throw error;
    }
  }

  async clockOut(tenantId: string, userId: string) {
    const today = this.tenantDateOnly(
      new Date(),
      await this.tenantTimezone(tenantId),
    );

    const attendance = await this.prisma.attendance.findFirst({
      where: { userId, date: today, tenantId },
      include: { shiftAssignment: { include: { shiftTemplate: true } } },
    });

    if (!attendance) {
      throw new NotFoundException("No attendance record for today");
    }

    if (attendance.status === AttendanceStatus.CLOCKED_OUT) {
      throw new BadRequestException("Already clocked out");
    }

    if (attendance.status === AttendanceStatus.ON_BREAK) {
      throw new BadRequestException(
        "Please end your break before clocking out",
      );
    }

    const now = new Date();
    // Clamp to zero: defends against a manually edited clockIn in the
    // future or a totalBreakMinutes that exceeds elapsed time.
    const totalWorkedMinutes = Math.max(
      0,
      Math.floor((now.getTime() - attendance.clockIn.getTime()) / 60000) -
        attendance.totalBreakMinutes,
    );

    let overtimeMinutes = 0;
    if (attendance.shiftAssignment?.shiftTemplate) {
      const template = attendance.shiftAssignment.shiftTemplate;
      const [startH, startM] = template.startTime.split(":").map(Number);
      const [endH, endM] = template.endTime.split(":").map(Number);
      let shiftDuration = endH * 60 + endM - (startH * 60 + startM);
      // Handle overnight shifts (e.g. 22:00 - 06:00)
      if (shiftDuration <= 0) shiftDuration += 24 * 60;
      overtimeMinutes = Math.max(0, totalWorkedMinutes - shiftDuration);
    }

    // Compound WHERE on the original status closes the TOCTOU window:
    // a concurrent break-start (status → ON_BREAK) between our read
    // above and the write here must not be silently overwritten as
    // CLOCKED_OUT. tenantId in the WHERE is defence-in-depth IDOR.
    const claim = await this.prisma.attendance.updateMany({
      where: { id: attendance.id, tenantId, status: attendance.status },
      data: {
        clockOut: now,
        status: AttendanceStatus.CLOCKED_OUT,
        totalWorkedMinutes,
        overtimeMinutes,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Attendance status changed concurrently — refresh and retry.",
      );
    }
    const result = await this.prisma.attendance.findUniqueOrThrow({
      where: { id: attendance.id },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });

    this.kdsGateway.emitAttendanceUpdate(tenantId, result.branchId, result);
    return result;
  }

  async breakStart(tenantId: string, userId: string) {
    const today = this.tenantDateOnly(
      new Date(),
      await this.tenantTimezone(tenantId),
    );

    const attendance = await this.prisma.attendance.findFirst({
      where: { userId, date: today, tenantId },
    });

    if (!attendance) {
      throw new NotFoundException("No attendance record for today");
    }

    if (attendance.status !== AttendanceStatus.CLOCKED_IN) {
      throw new BadRequestException("Must be clocked in to start a break");
    }

    // Compound WHERE on status — race-safe; tenant guard defence-in-depth.
    const claim = await this.prisma.attendance.updateMany({
      where: {
        id: attendance.id,
        tenantId,
        status: AttendanceStatus.CLOCKED_IN,
      },
      data: {
        breakStart: new Date(),
        status: AttendanceStatus.ON_BREAK,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Attendance status changed concurrently — refresh and retry.",
      );
    }
    const result = await this.prisma.attendance.findUniqueOrThrow({
      where: { id: attendance.id },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });

    this.kdsGateway.emitAttendanceUpdate(tenantId, result.branchId, result);
    return result;
  }

  async breakEnd(tenantId: string, userId: string) {
    const today = this.tenantDateOnly(
      new Date(),
      await this.tenantTimezone(tenantId),
    );

    const attendance = await this.prisma.attendance.findFirst({
      where: { userId, date: today, tenantId },
    });

    if (!attendance) {
      throw new NotFoundException("No attendance record for today");
    }

    if (attendance.status !== AttendanceStatus.ON_BREAK) {
      throw new BadRequestException("Not currently on break");
    }

    if (!attendance.breakStart) {
      throw new BadRequestException("Break start time not found");
    }

    const now = new Date();
    const breakDuration = Math.floor(
      (now.getTime() - attendance.breakStart.getTime()) / 60000,
    );

    // Compound WHERE on status — race-safe; tenant guard defence-in-depth.
    // totalBreakMinutes uses { increment } instead of stale-read + delta:
    // the row was read at the top of the method; if an admin payroll-
    // correction endpoint or a separate breakStart/breakEnd cycle touched
    // totalBreakMinutes between the read and the write here, the bare
    // `attendance.totalBreakMinutes + breakDuration` form would silently
    // overwrite that change with this stale snapshot.
    const claim = await this.prisma.attendance.updateMany({
      where: { id: attendance.id, tenantId, status: AttendanceStatus.ON_BREAK },
      data: {
        breakEnd: now,
        status: AttendanceStatus.CLOCKED_IN,
        totalBreakMinutes: { increment: breakDuration },
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Attendance status changed concurrently — refresh and retry.",
      );
    }
    const result = await this.prisma.attendance.findUniqueOrThrow({
      where: { id: attendance.id },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });

    this.kdsGateway.emitAttendanceUpdate(tenantId, result.branchId, result);
    return result;
  }

  async getMyStatus(scope: BranchScope) {
    const today = this.tenantDateOnly(
      new Date(),
      await this.tenantTimezone(scope.tenantId),
    );

    // deep-review M8: the self-status read is intentionally NOT pinned
    // to the active branch. Attendance is one-row-per-user-per-day
    // (@@unique([userId, date])) and clockIn pins the row to the user's
    // PRIMARY branch. A roaming ADMIN/MANAGER whose active branch != their
    // primary branch would otherwise see themselves as NOT_CLOCKED_IN,
    // be blocked from clocking in again, and break clock-out/break. This
    // stays safe from IDOR: it is still self-scoped (userId) AND
    // tenant-scoped. (Roster reads below remain branch-scoped by design;
    // worked-branch vs home-branch attribution is a deferred product call.)
    const attendance = await this.prisma.attendance.findFirst({
      where: { tenantId: scope.tenantId, userId: scope.userId, date: today },
      include: {
        shiftAssignment: { include: { shiftTemplate: true } },
        user: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });

    return attendance || { status: "NOT_CLOCKED_IN", date: today };
  }

  async getTodayAttendance(scope: BranchScope) {
    const today = this.tenantDateOnly(
      new Date(),
      await this.tenantTimezone(scope.tenantId),
    );

    return this.prisma.attendance.findMany({
      where: { ...branchScope(scope), date: today },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        shiftAssignment: { include: { shiftTemplate: true } },
      },
      orderBy: { clockIn: "desc" },
    });
  }

  async getAttendanceHistory(scope: BranchScope, query: AttendanceQueryDto) {
    const where: any = { ...branchScope(scope) };

    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = new Date(query.startDate);
      if (query.endDate) {
        // Include the whole calendar day — a bare ISO date parses as
        // 00:00:00, which otherwise excludes everything that happened
        // on the endDate itself.
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }

    const page = query.page || 1;
    const limit = query.limit || 50;

    const [data, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, role: true },
          },
          shiftAssignment: { include: { shiftTemplate: true } },
        },
        orderBy: { date: "desc" },
        take: limit,
        skip: (page - 1) * limit,
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return paginated(data, total, page, limit);
  }

  async getAttendanceSummary(
    scope: BranchScope,
    query: AttendanceSummaryQueryDto,
  ) {
    const now = new Date();
    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = query.endDate ? new Date(query.endDate) : now;

    const attendances = await this.prisma.attendance.findMany({
      where: {
        ...branchScope(scope),
        date: { gte: startDate, lte: endDate },
        status: AttendanceStatus.CLOCKED_OUT,
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });

    // Group by user
    const userMap = new Map<string, any>();
    for (const a of attendances) {
      if (!userMap.has(a.userId)) {
        userMap.set(a.userId, {
          user: a.user,
          totalDays: 0,
          totalWorkedMinutes: 0,
          totalBreakMinutes: 0,
          totalOvertimeMinutes: 0,
          lateDays: 0,
          totalLateMinutes: 0,
        });
      }
      const summary = userMap.get(a.userId);
      summary.totalDays++;
      summary.totalWorkedMinutes += a.totalWorkedMinutes;
      summary.totalBreakMinutes += a.totalBreakMinutes;
      summary.totalOvertimeMinutes += a.overtimeMinutes;
      if (a.isLate) {
        summary.lateDays++;
        summary.totalLateMinutes += a.lateMinutes;
      }
    }

    return Array.from(userMap.values());
  }
}
