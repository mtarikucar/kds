import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssignShiftDto, BulkAssignShiftDto } from '../dto/assign-shift.dto';

@Injectable()
export class ScheduleService {
  constructor(private prisma: PrismaService) {}

  async getWeeklySchedule(tenantId: string, weekStart?: string) {
    const start = weekStart ? new Date(weekStart) : this.getMonday(new Date());
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const assignments = await this.prisma.shiftAssignment.findMany({
      where: {
        tenantId,
        date: { gte: start, lte: end },
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
        shiftTemplate: true,
      },
      orderBy: [{ date: 'asc' }, { user: { firstName: 'asc' } }],
    });

    // Also get all staff for the tenant
    const staff = await this.prisma.user.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: { firstName: 'asc' },
    });

    return { weekStart: start, weekEnd: end, assignments, staff };
  }

  async assign(tenantId: string, dto: AssignShiftDto) {
    // Validate user belongs to tenant
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, tenantId },
    });
    if (!user) throw new NotFoundException('User not found in this tenant');

    // Validate shift template belongs to tenant
    const template = await this.prisma.shiftTemplate.findFirst({
      where: { id: dto.shiftTemplateId, tenantId },
    });
    if (!template) throw new NotFoundException('Shift template not found');

    const date = new Date(dto.date);
    date.setHours(0, 0, 0, 0);

    try {
      return await this.prisma.shiftAssignment.create({
        data: {
          userId: dto.userId,
          shiftTemplateId: dto.shiftTemplateId,
          date,
          notes: dto.notes,
          tenantId,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, role: true } },
          shiftTemplate: true,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BadRequestException('User already has a shift assigned for this date');
      }
      throw error;
    }
  }

  async assignBulk(tenantId: string, dto: BulkAssignShiftDto) {
    const successes = [];
    const failures = [];
    for (const assignment of dto.assignments) {
      try {
        const result = await this.assign(tenantId, assignment);
        successes.push(result);
      } catch (error: any) {
        failures.push({ error: error.message, assignment });
      }
    }
    return { successes, failures, total: dto.assignments.length };
  }

  async remove(id: string, tenantId: string) {
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { id, tenantId },
    });

    if (!assignment) {
      throw new NotFoundException('Shift assignment not found');
    }

    return this.prisma.shiftAssignment.delete({ where: { id } });
  }

  private getMonday(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d;
  }
}
