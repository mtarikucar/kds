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
   * Resolve the tenant-local-midnight UTC instant for "today". Same
   * helper z-reports uses (iter-35). Without this, server-local
   * midnight diverges from the tenant's "today" — a user clocking
   * in at 02:00 TR on a UTC container gets stamped with the previous
   * server date, which then breaks payroll-export day boundaries
   * and the shift-late calculation against shiftTemplate.startTime.
   */
  private async tenantToday(tenantId: string): Promise<Date> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return getTenantMidnight(new Date(), tenant?.timezone || "UTC");
  }

  async clockIn(tenantId: string, userId: string, notes?: string) {
    const today = await this.tenantToday(tenantId);

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

      const shiftStart = new Date(today);
      shiftStart.setHours(shiftHour, shiftMin, 0, 0);

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
    const today = await this.tenantToday(tenantId);

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
    const today = await this.tenantToday(tenantId);

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
    const today = await this.tenantToday(tenantId);

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
    const today = await this.tenantToday(scope.tenantId);

    // Self-scoped to the acting user, but still pinned to the active
    // branch: a user only sees their record within the branch they are
    // operating in (matches the v3.0.0 branch-scope design).
    const attendance = await this.prisma.attendance.findFirst({
      where: { ...branchScope(scope), userId: scope.userId, date: today },
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
    const today = await this.tenantToday(scope.tenantId);

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
