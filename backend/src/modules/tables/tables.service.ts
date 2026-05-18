import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { KdsGateway } from '../kds/kds.gateway';
import { CreateTableDto, TableStatus } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { MergeTablesDto, UnmergeTableDto } from './dto/merge-tables.dto';
import { OrderStatus } from '../../common/constants/order-status.enum';
import { randomUUID } from 'crypto';

/**
 * Fallback pre-start window when a tenant has no ReservationSettings
 * row. Once the row exists, the per-tenant `holdOffsetMinutes`
 * overrides this and the annotation lines up with the scheduler's
 * auto-hold and the POS reservation-action dialog.
 */
const DEFAULT_HOLD_OFFSET_MINUTES = 30;

/**
 * After a reservation's startTime, how long the annotation continues
 * to surface the booking so the dialog can still offer "seat" while
 * the waiter chases down the no-show. Matches the scheduler's
 * GRACE_AFTER_START_MINUTES; once past this point the scheduler flips
 * the row to NO_SHOW and clears the table hold.
 */
const GRACE_AFTER_START_MINUTES = 30;

export interface UpcomingReservation {
  id: string;
  startTime: string;
  endTime: string;
  customerName: string;
  guestCount: number;
  status: string;
  startsAt: string; // ISO datetime — frontend can compute "in N minutes"
}

@Injectable()
export class TablesService {
  constructor(
    private prisma: PrismaService,
    private kdsGateway: KdsGateway,
  ) {}

  async create(createTableDto: CreateTableDto, tenantId: string) {
    // Check if table number already exists for this tenant
    const existingTable = await this.prisma.table.findUnique({
      where: {
        tenantId_number: {
          tenantId,
          number: createTableDto.number,
        },
      },
    });

    if (existingTable) {
      throw new ConflictException(
        `Table number ${createTableDto.number} already exists`,
      );
    }

    return this.prisma.table.create({
      data: {
        number: createTableDto.number,
        capacity: createTableDto.capacity,
        section: createTableDto.section,
        status: createTableDto.status || TableStatus.AVAILABLE,
        tenantId,
      },
    });
  }

  async findAll(tenantId: string, section?: string) {
    const where: any = { tenantId };
    if (section) {
      where.section = section;
    }

    const tables = await this.prisma.table.findMany({
      where,
      include: {
        _count: {
          select: {
            orders: {
              where: {
                status: {
                  notIn: [OrderStatus.PAID, OrderStatus.CANCELLED],
                },
              },
            },
          },
        },
      },
      orderBy: { number: 'asc' },
    });

    // Annotate each table with the next CONFIRMED reservation in the
    // next 2 hours, if any. Lets the floor plan render a small "🕐
    // 19:00 — Ayşe (4)" badge and lets the POS warn before opening a
    // walk-in. We compute it here rather than per-row in the frontend
    // so all clients see the same view.
    const annotated = await this.annotateWithUpcomingReservations(tenantId, tables);
    return annotated;
  }

  /**
   * Attach `upcomingReservation` to each table — the next CONFIRMED
   * (or PENDING) reservation inside the per-tenant hold window:
   * `[startTime - holdOffsetMinutes, startTime + 30 min grace]`.
   * Matches the scheduler so the dialog surfaces exactly when the
   * table is (or will momentarily be) auto-RESERVED. Outside this
   * window the table is free for walk-ins.
   */
  private async annotateWithUpcomingReservations<T extends { id: string }>(
    tenantId: string,
    tables: T[],
  ): Promise<(T & { upcomingReservation: UpcomingReservation | null })[]> {
    if (tables.length === 0) return [] as any;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Per-tenant pre-start hold window. Single row lookup — keep it
    // unwrapped here rather than passing through every call site.
    const settings = await this.prisma.reservationSettings.findUnique({
      where: { tenantId },
      select: { holdOffsetMinutes: true },
    });
    const holdOffsetMin = settings?.holdOffsetMinutes ?? DEFAULT_HOLD_OFFSET_MINUTES;

    const tableIds = tables.map((t) => t.id);
    const candidates = await this.prisma.reservation.findMany({
      where: {
        tenantId,
        tableId: { in: tableIds },
        date: { in: [today, tomorrow] },
        status: { in: ['CONFIRMED', 'PENDING'] },
      },
      select: {
        id: true,
        tableId: true,
        date: true,
        startTime: true,
        endTime: true,
        customerName: true,
        guestCount: true,
        status: true,
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    const byTable = new Map<string, UpcomingReservation>();
    for (const r of candidates) {
      if (!r.tableId) continue;
      const [sh, sm] = r.startTime.split(':').map(Number);
      const start = new Date(r.date);
      start.setHours(sh, sm, 0, 0);

      // Annotation window: open `holdOffsetMin` minutes before start,
      // closes `GRACE_AFTER_START_MINUTES` after start (the same grace
      // the scheduler honors before auto-NO_SHOW). The sort above
      // guarantees first match is the closest one.
      const windowOpen = new Date(start.getTime() - holdOffsetMin * 60_000);
      const windowClose = new Date(start.getTime() + GRACE_AFTER_START_MINUTES * 60_000);
      if (now < windowOpen || now > windowClose) continue;
      if (byTable.has(r.tableId)) continue;

      byTable.set(r.tableId, {
        id: r.id,
        startTime: r.startTime,
        endTime: r.endTime,
        customerName: r.customerName,
        guestCount: r.guestCount,
        status: r.status,
        startsAt: start.toISOString(),
      });
    }

    return tables.map((t) => ({
      ...t,
      upcomingReservation: byTable.get(t.id) ?? null,
    }));
  }

  async findAvailableForCustomers(tenantId: string) {
    return this.prisma.table.findMany({
      where: {
        tenantId,
        status: {
          in: [TableStatus.AVAILABLE, TableStatus.OCCUPIED],
        },
      },
      select: {
        id: true,
        number: true,
        capacity: true,
        status: true,
      },
      orderBy: { number: 'asc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const table = await this.prisma.table.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        orders: {
          where: {
            status: {
              notIn: [OrderStatus.PAID, OrderStatus.CANCELLED],
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!table) {
      throw new NotFoundException(`Table with ID ${id} not found`);
    }

    return table;
  }

  async update(id: string, updateTableDto: UpdateTableDto, tenantId: string) {
    // Check if table exists and belongs to tenant
    await this.findOne(id, tenantId);

    // If table number is being updated, check for conflicts
    if (updateTableDto.number) {
      const existingTable = await this.prisma.table.findUnique({
        where: {
          tenantId_number: {
            tenantId,
            number: updateTableDto.number,
          },
        },
      });

      if (existingTable && existingTable.id !== id) {
        throw new ConflictException(
          `Table number ${updateTableDto.number} already exists`,
        );
      }
    }

    return this.prisma.table.update({
      where: { id },
      data: updateTableDto,
    });
  }

  async updateStatus(id: string, updateStatusDto: UpdateTableStatusDto, tenantId: string) {
    // Atomic status transition with active-order guard. Without the
    // transaction + count check, two waiters clicking "Mark AVAILABLE"
    // moments apart can both succeed even if a new order was just
    // created — leaving the table free to be seated again while an
    // unpaid bill is still open.
    return this.prisma.$transaction(async (tx) => {
      const table = await tx.table.findFirst({ where: { id, tenantId } });
      if (!table) throw new NotFoundException('Table not found');

      // Marking AVAILABLE must not happen while active orders are open.
      // The frontend already filters for this, but two concurrent waiters
      // or a stale snapshot can both submit — backend is the canonical
      // gatekeeper.
      if (updateStatusDto.status === TableStatus.AVAILABLE) {
        const activeOrders = await tx.order.count({
          where: {
            tableId: id,
            tenantId,
            status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
          },
        });
        if (activeOrders > 0) {
          throw new ConflictException(
            'Cannot mark table AVAILABLE while it has active orders',
          );
        }
      }

      return tx.table.update({
        where: { id },
        data: { status: updateStatusDto.status },
      });
    });
  }

  async remove(id: string, tenantId: string) {
    // Atomic remove: verify tenant ownership + count active orders + delete in
    // a single transaction so an order created between the count and the
    // delete can't orphan the FK.
    return this.prisma.$transaction(async (tx) => {
      const table = await tx.table.findFirst({ where: { id, tenantId } });
      if (!table) throw new NotFoundException('Table not found');

      const activeOrders = await tx.order.count({
        where: {
          tableId: id,
          tenantId,
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        },
      });
      if (activeOrders > 0) {
        throw new ConflictException('Cannot delete table with active orders');
      }
      return tx.table.delete({ where: { id } });
    });
  }

  // ========================================
  // TABLE MERGE / SPLIT
  // ========================================

  async mergeTables(dto: MergeTablesDto, tenantId: string) {
    return this.prisma.$transaction(async (tx) => {
      const tables = await tx.table.findMany({
        where: { id: { in: dto.tableIds }, tenantId },
      });

      if (tables.length !== dto.tableIds.length) {
        throw new NotFoundException('One or more tables not found');
      }

      // Check if any table is already in a different group
      const existingGroupIds = tables
        .map(t => t.groupId)
        .filter(Boolean) as string[];
      const uniqueGroups = [...new Set(existingGroupIds)];

      // Use existing groupId if one of the tables is already in a group, otherwise create new
      const groupId = uniqueGroups.length > 0 ? uniqueGroups[0] : randomUUID();

      // If multiple groups exist, merge them all into one
      if (uniqueGroups.length > 1) {
        await tx.table.updateMany({
          where: { groupId: { in: uniqueGroups }, tenantId },
          data: { groupId },
        });
      }

      // Assign groupId to all requested tables
      await tx.table.updateMany({
        where: { id: { in: dto.tableIds }, tenantId },
        data: { groupId },
      });

      return { groupId, tableNumbers: tables.map(t => t.number) };
    }).then(({ groupId, tableNumbers }) => {
      this.kdsGateway.emitTableMerge(tenantId, { groupId, tableNumbers });
      return this.getTableGroup(groupId, tenantId);
    });
  }

  async unmergeTable(dto: UnmergeTableDto, tenantId: string) {
    return this.prisma.$transaction(async (tx) => {
      const table = await tx.table.findFirst({
        where: { id: dto.tableId, tenantId },
      });

      if (!table) {
        throw new NotFoundException('Table not found');
      }

      if (!table.groupId) {
        throw new BadRequestException('Table is not part of any group');
      }

      const groupId = table.groupId;

      // Remove this table from group
      await tx.table.update({
        where: { id: dto.tableId },
        data: { groupId: null },
      });

      // Check remaining group members
      const remaining = await tx.table.count({
        where: { groupId, tenantId },
      });

      // If only 1 table left, dissolve the group entirely
      if (remaining <= 1) {
        await tx.table.updateMany({
          where: { groupId, tenantId },
          data: { groupId: null },
        });
      }

      return { message: 'Table unmerged successfully', tableId: dto.tableId, tableNumber: table.number, groupId };
    }).then((result) => {
      this.kdsGateway.emitTableUnmerge(tenantId, { tableNumber: result.tableNumber, groupId: result.groupId });
      return { message: result.message, tableId: result.tableId };
    });
  }

  async unmergeAll(groupId: string, tenantId: string) {
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.table.count({
        where: { groupId, tenantId },
      });

      if (count === 0) {
        throw new NotFoundException('No tables found in this group');
      }

      await tx.table.updateMany({
        where: { groupId, tenantId },
        data: { groupId: null },
      });

      return { message: 'All tables unmerged successfully' };
    }).then((result) => {
      this.kdsGateway.emitTableUnmerge(tenantId, { tableNumber: 'all', groupId });
      return result;
    });
  }

  async getTableGroup(groupId: string, tenantId: string) {
    const tables = await this.prisma.table.findMany({
      where: { groupId, tenantId },
      include: {
        orders: {
          where: {
            status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
          },
          include: {
            orderItems: {
              include: {
                product: true,
                modifiers: { include: { modifier: true } },
              },
            },
            payments: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { number: 'asc' },
    });

    if (tables.length === 0) {
      throw new NotFoundException('Table group not found');
    }

    const allOrders = tables.flatMap(t => t.orders);
    const totalAmount = allOrders.reduce((sum, o) => sum + Number(o.finalAmount), 0);
    const totalPaid = allOrders.reduce((sum, o) =>
      sum + o.payments
        .filter(p => p.status === 'COMPLETED')
        .reduce((ps, p) => ps + Number(p.amount), 0),
      0
    );

    return {
      groupId,
      tables: tables.map(t => ({
        id: t.id,
        number: t.number,
        capacity: t.capacity,
        section: t.section,
        status: t.status,
      })),
      orders: allOrders,
      summary: {
        totalOrders: allOrders.length,
        totalAmount,
        totalPaid,
        remainingAmount: totalAmount - totalPaid,
      },
    };
  }
}
