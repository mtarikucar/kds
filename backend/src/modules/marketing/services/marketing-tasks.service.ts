import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTaskDto } from '../dto/create-task.dto';
import { UpdateTaskDto } from '../dto/update-task.dto';
import { TaskFilterDto } from '../dto/task-filter.dto';

// Allow a small grace for clock skew before rejecting a dueDate as
// "in the past". 5 minutes is enough for any sane client drift.
const PAST_DUE_GRACE_MS = 5 * 60 * 1000;
const MAX_CALENDAR_RANGE_DAYS = 62;

@Injectable()
export class MarketingTasksService {
  constructor(private prisma: PrismaService) {}

  private assertDueDateNotInPast(dueDate: Date | string): Date {
    const d = new Date(dueDate);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Invalid dueDate');
    }
    if (d.getTime() < Date.now() - PAST_DUE_GRACE_MS) {
      throw new BadRequestException('dueDate must not be in the past');
    }
    return d;
  }

  async create(dto: CreateTaskDto, userId: string) {
    return this.prisma.marketingTask.create({
      data: {
        title: dto.title,
        description: dto.description,
        type: dto.type,
        priority: dto.priority || 'MEDIUM',
        dueDate: this.assertDueDateNotInPast(dto.dueDate),
        leadId: dto.leadId,
        assignedToId: dto.assignedToId || userId,
      },
      include: {
        lead: { select: { id: true, businessName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async findAll(filter: TaskFilterDto, userId: string, userRole: string) {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (userRole === 'SALES_REP') {
      where.assignedToId = userId;
    } else if (filter.assignedToId) {
      where.assignedToId = filter.assignedToId;
    }

    if (filter.status) where.status = filter.status;
    if (filter.type) where.type = filter.type;
    if (filter.priority) where.priority = filter.priority;
    if (filter.leadId) where.leadId = filter.leadId;

    if (filter.dateFrom || filter.dateTo) {
      where.dueDate = {};
      if (filter.dateFrom) where.dueDate.gte = new Date(filter.dateFrom);
      if (filter.dateTo) where.dueDate.lte = new Date(filter.dateTo);
    }

    const allowedSortFields = ['createdAt', 'updatedAt', 'dueDate', 'title', 'type', 'status', 'priority'];
    const orderBy: any = {};
    if (filter.sortBy && allowedSortFields.includes(filter.sortBy)) {
      orderBy[filter.sortBy] = filter.sortOrder || 'asc';
    } else {
      orderBy.dueDate = 'asc';
    }

    const [tasks, total] = await Promise.all([
      this.prisma.marketingTask.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          lead: { select: { id: true, businessName: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.marketingTask.count({ where }),
    ]);

    return {
      data: tasks,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findToday(userId: string, userRole: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const where: any = {
      dueDate: { gte: today, lt: tomorrow },
      status: { not: 'CANCELLED' },
    };

    if (userRole === 'SALES_REP') {
      where.assignedToId = userId;
    }

    return this.prisma.marketingTask.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: {
        lead: { select: { id: true, businessName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async findOverdue(userId: string, userRole: string) {
    const now = new Date();
    const where: any = {
      dueDate: { lt: now },
      status: { in: ['PENDING', 'IN_PROGRESS'] },
    };

    if (userRole === 'SALES_REP') {
      where.assignedToId = userId;
    }

    return this.prisma.marketingTask.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: {
        lead: { select: { id: true, businessName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async findCalendar(dateFrom: string, dateTo: string, userId: string, userRole: string) {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date range');
    }
    if (from > to) {
      throw new BadRequestException('dateFrom must be <= dateTo');
    }
    const rangeDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    if (rangeDays > MAX_CALENDAR_RANGE_DAYS) {
      throw new BadRequestException(
        `Calendar range cannot exceed ${MAX_CALENDAR_RANGE_DAYS} days`,
      );
    }

    const where: any = {
      dueDate: { gte: from, lte: to },
    };

    if (userRole === 'SALES_REP') {
      where.assignedToId = userId;
    }

    return this.prisma.marketingTask.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      take: 500,
      include: {
        lead: { select: { id: true, businessName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async findOne(id: string, userId: string, userRole: string) {
    const task = await this.prisma.marketingTask.findUnique({
      where: { id },
      include: {
        lead: { select: { id: true, businessName: true, contactPerson: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!task) throw new NotFoundException('Task not found');

    if (userRole === 'SALES_REP' && task.assignedToId !== userId) {
      throw new ForbiddenException('You can only view your own tasks');
    }

    return task;
  }

  async update(id: string, dto: UpdateTaskDto, userId: string, userRole: string) {
    const task = await this.prisma.marketingTask.findUnique({ where: { id } });

    if (!task) throw new NotFoundException('Task not found');

    if (userRole === 'SALES_REP' && task.assignedToId !== userId) {
      throw new ForbiddenException('You can only update your own tasks');
    }

    const data: any = { ...dto };
    if (dto.dueDate) data.dueDate = new Date(dto.dueDate);

    return this.prisma.marketingTask.update({
      where: { id },
      data,
      include: {
        lead: { select: { id: true, businessName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async complete(id: string, userId: string, userRole: string) {
    const task = await this.prisma.marketingTask.findUnique({ where: { id } });

    if (!task) throw new NotFoundException('Task not found');

    if (userRole === 'SALES_REP' && task.assignedToId !== userId) {
      throw new ForbiddenException('You can only complete your own tasks');
    }

    return this.prisma.marketingTask.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  async delete(id: string, userId: string, userRole: string) {
    const task = await this.prisma.marketingTask.findUnique({ where: { id } });

    if (!task) throw new NotFoundException('Task not found');

    if (userRole === 'SALES_REP' && task.assignedToId !== userId) {
      throw new ForbiddenException('You can only delete your own tasks');
    }

    await this.prisma.marketingTask.delete({ where: { id } });
    return { message: 'Task deleted successfully' };
  }
}
