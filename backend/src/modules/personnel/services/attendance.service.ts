import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { KdsGateway } from '../../kds/kds.gateway';
import { AttendanceStatus } from '../constants/personnel.enum';
import { AttendanceQueryDto, AttendanceSummaryQueryDto } from '../dto/attendance-query.dto';

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private kdsGateway: KdsGateway,
  ) {}

  async clockIn(tenantId: string, userId: string, notes?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check no existing active record for today
    const existing = await this.prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    if (existing && existing.status !== AttendanceStatus.CLOCKED_OUT) {
      throw new BadRequestException('Already clocked in today');
    }

    if (existing && existing.status === AttendanceStatus.CLOCKED_OUT) {
      throw new BadRequestException('Already clocked out today. Cannot clock in again.');
    }

    // Find shift assignment for today
    const shiftAssignment = await this.prisma.shiftAssignment.findUnique({
      where: { userId_date: { userId, date: today } },
      include: { shiftTemplate: true },
    });

    let isLate = false;
    let lateMinutes = 0;
    const now = new Date();

    if (shiftAssignment?.shiftTemplate) {
      const [shiftHour, shiftMin] = shiftAssignment.shiftTemplate.startTime.split(':').map(Number);
      const gracePeriod = shiftAssignment.shiftTemplate.gracePeriodMinutes;

      const shiftStart = new Date(today);
      shiftStart.setHours(shiftHour, shiftMin, 0, 0);

      const graceEnd = new Date(shiftStart.getTime() + gracePeriod * 60000);

      if (now > graceEnd) {
        isLate = true;
        lateMinutes = Math.floor((now.getTime() - shiftStart.getTime()) / 60000);
      }
    }

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
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
    });

    this.kdsGateway.emitAttendanceUpdate(tenantId, result);
    return result;
  }

  async clockOut(tenantId: string, userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
      include: { shiftAssignment: { include: { shiftTemplate: true } } },
    });

    if (!attendance) {
      throw new NotFoundException('No attendance record for today');
    }

    if (attendance.status === AttendanceStatus.CLOCKED_OUT) {
      throw new BadRequestException('Already clocked out');
    }

    if (attendance.status === AttendanceStatus.ON_BREAK) {
      throw new BadRequestException('Please end your break before clocking out');
    }

    const now = new Date();
    const totalWorkedMinutes = Math.floor(
      (now.getTime() - attendance.clockIn.getTime()) / 60000,
    ) - attendance.totalBreakMinutes;

    let overtimeMinutes = 0;
    if (attendance.shiftAssignment?.shiftTemplate) {
      const template = attendance.shiftAssignment.shiftTemplate;
      const [startH, startM] = template.startTime.split(':').map(Number);
      const [endH, endM] = template.endTime.split(':').map(Number);
      let shiftDuration = (endH * 60 + endM) - (startH * 60 + startM);
      // Handle overnight shifts (e.g. 22:00 - 06:00)
      if (shiftDuration <= 0) shiftDuration += 24 * 60;
      overtimeMinutes = Math.max(0, totalWorkedMinutes - shiftDuration);
    }

    const result = await this.prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        clockOut: now,
        status: AttendanceStatus.CLOCKED_OUT,
        totalWorkedMinutes,
        overtimeMinutes,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
    });

    this.kdsGateway.emitAttendanceUpdate(tenantId, result);
    return result;
  }

  async breakStart(tenantId: string, userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    if (!attendance) {
      throw new NotFoundException('No attendance record for today');
    }

    if (attendance.status !== AttendanceStatus.CLOCKED_IN) {
      throw new BadRequestException('Must be clocked in to start a break');
    }

    const result = await this.prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        breakStart: new Date(),
        status: AttendanceStatus.ON_BREAK,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
    });

    this.kdsGateway.emitAttendanceUpdate(tenantId, result);
    return result;
  }

  async breakEnd(tenantId: string, userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    if (!attendance) {
      throw new NotFoundException('No attendance record for today');
    }

    if (attendance.status !== AttendanceStatus.ON_BREAK) {
      throw new BadRequestException('Not currently on break');
    }

    if (!attendance.breakStart) {
      throw new BadRequestException('Break start time not found');
    }

    const now = new Date();
    const breakDuration = Math.floor(
      (now.getTime() - attendance.breakStart.getTime()) / 60000,
    );

    const result = await this.prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        breakEnd: now,
        status: AttendanceStatus.CLOCKED_IN,
        totalBreakMinutes: attendance.totalBreakMinutes + breakDuration,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
    });

    this.kdsGateway.emitAttendanceUpdate(tenantId, result);
    return result;
  }

  async getMyStatus(tenantId: string, userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
      include: {
        shiftAssignment: { include: { shiftTemplate: true } },
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    return attendance || { status: 'NOT_CLOCKED_IN', date: today };
  }

  async getTodayAttendance(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.attendance.findMany({
      where: { tenantId, date: today },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
        shiftAssignment: { include: { shiftTemplate: true } },
      },
      orderBy: { clockIn: 'desc' },
    });
  }

  async getAttendanceHistory(tenantId: string, query: AttendanceQueryDto) {
    const where: any = { tenantId };

    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = new Date(query.startDate);
      if (query.endDate) where.date.lte = new Date(query.endDate);
    }

    const page = query.page || 1;
    const limit = query.limit || 50;

    const [data, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, role: true } },
          shiftAssignment: { include: { shiftTemplate: true } },
        },
        orderBy: { date: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getAttendanceSummary(tenantId: string, query: AttendanceSummaryQueryDto) {
    const now = new Date();
    const startDate = query.startDate ? new Date(query.startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = query.endDate ? new Date(query.endDate) : now;

    const attendances = await this.prisma.attendance.findMany({
      where: {
        tenantId,
        date: { gte: startDate, lte: endDate },
        status: AttendanceStatus.CLOCKED_OUT,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
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
