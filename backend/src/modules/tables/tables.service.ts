import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { KdsGateway } from "../kds/kds.gateway";
import { CreateTableDto, TableStatus } from "./dto/create-table.dto";
import { UpdateTableDto } from "./dto/update-table.dto";
import { UpdateTableStatusDto } from "./dto/update-table-status.dto";
import { MergeTablesDto, UnmergeTableDto } from "./dto/merge-tables.dto";
import { OrderStatus } from "../../common/constants/order-status.enum";
import { BranchScope, branchScope } from "../../common/scoping/branch-scope";
import { ReservationAvailabilityService } from "../reservations/services/reservation-availability.service";
import { randomUUID } from "crypto";

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
    // Shared public branch resolver (validates branch ∈ tenant + active,
    // else oldest-active fallback). The customer-facing table listing is
    // anonymous (@Public / @SkipBranchScope) so the branch is derived the
    // same way the public reservation flow derives it — keeping "tables a
    // guest can pick" consistent with the branch a booking lands on.
    private reservationAvailability: ReservationAvailabilityService,
  ) {}

  async create(scope: BranchScope, createTableDto: CreateTableDto) {
    // v3 branch-scope: table numbers are unique PER BRANCH, not per
    // tenant — branch A and branch B may both own table #1. Check against
    // the compound (tenantId, branchId, number) key.
    const existingTable = await this.prisma.table.findUnique({
      where: {
        tenantId_branchId_number: {
          tenantId: scope.tenantId,
          branchId: scope.branchId,
          number: createTableDto.number,
        },
      },
    });

    if (existingTable) {
      throw new ConflictException(
        `Table number ${createTableDto.number} already exists`,
      );
    }

    // v3.0.0 strict: every Table now requires a branchId (Restrict on
    // delete). Sourced from @CurrentScope() in the controller — the
    // table physically belongs to one branch and OrdersService.create
    // copies this onto each order.
    return this.prisma.table.create({
      data: {
        number: createTableDto.number,
        capacity: createTableDto.capacity,
        section: createTableDto.section,
        status: createTableDto.status || TableStatus.AVAILABLE,
        tenantId: scope.tenantId,
        branchId: scope.branchId,
      },
    });
  }

  async findAll(scope: BranchScope, section?: string) {
    // v3.0.0 — branchScope(scope) spreads `{ tenantId, branchId }` so a
    // MANAGER scoped to branch A never sees branch B's tables. Pre-v3
    // this filtered by tenantId only; the leak surfaced in the v3
    // finalization audit.
    const where: any = { ...branchScope(scope) };
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
      orderBy: { number: "asc" },
    });

    // Annotate each table with the next CONFIRMED reservation in the
    // next 2 hours, if any. Lets the floor plan render a small "🕐
    // 19:00 — Ayşe (4)" badge and lets the POS warn before opening a
    // walk-in. We compute it here rather than per-row in the frontend
    // so all clients see the same view.
    const annotated = await this.annotateWithUpcomingReservations(
      scope,
      tables,
    );
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
    scope: BranchScope,
    tables: T[],
  ): Promise<(T & { upcomingReservation: UpcomingReservation | null })[]> {
    if (tables.length === 0) return [] as any;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Per-tenant pre-start hold window. Single row lookup — keep it
    // unwrapped here rather than passing through every call site.
    // ReservationSettings is tenant-scoped (one row per tenant with
    // branchId=null); the per-branch override row is a v3.1 follow-up.
    // v3.0.1 — findFirst (see branch-scope helper note).
    const settings = await this.prisma.reservationSettings.findFirst({
      where: { tenantId: scope.tenantId, branchId: null },
      select: { holdOffsetMinutes: true },
    });
    const holdOffsetMin =
      settings?.holdOffsetMinutes ?? DEFAULT_HOLD_OFFSET_MINUTES;

    const tableIds = tables.map((t) => t.id);
    // Reservations look up via the tables already filtered into this
    // branch — `tableId IN (...)` is the implicit branch scope. Belt:
    // also add `tenantId` so a stale cache or wrongly-included tableId
    // can't pull in a different tenant's reservation.
    const candidates = await this.prisma.reservation.findMany({
      where: {
        tenantId: scope.tenantId,
        tableId: { in: tableIds },
        date: { in: [today, tomorrow] },
        status: { in: ["CONFIRMED", "PENDING"] },
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
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    const byTable = new Map<string, UpcomingReservation>();
    for (const r of candidates) {
      if (!r.tableId) continue;
      const [sh, sm] = r.startTime.split(":").map(Number);
      const start = new Date(r.date);
      start.setHours(sh, sm, 0, 0);

      // Annotation window: open `holdOffsetMin` minutes before start,
      // closes `GRACE_AFTER_START_MINUTES` after start (the same grace
      // the scheduler honors before auto-NO_SHOW). The sort above
      // guarantees first match is the closest one.
      const windowOpen = new Date(start.getTime() - holdOffsetMin * 60_000);
      const windowClose = new Date(
        start.getTime() + GRACE_AFTER_START_MINUTES * 60_000,
      );
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

  /**
   * Public, customer-facing table listing for a single branch.
   *
   * This is an anonymous (@Public / @SkipBranchScope) read, so there is
   * no @CurrentScope — the branch is derived rather than asserted via
   * `resolvePublicBranchId` (explicit `branchId` when it belongs to the
   * tenant and is active, else the tenant's oldest-active branch). Pre-fix
   * this filtered by `tenantId` only, so GET /tables/public/:tenantId
   * leaked EVERY branch's tables to anonymous callers; a multi-branch
   * tenant's downtown floor plan showed up in the suburb's QR menu. The
   * branchId clause closes that leak.
   */
  async findAvailableForCustomers(tenantId: string, branchId?: string) {
    const resolvedBranchId =
      await this.reservationAvailability.resolvePublicBranchId(
        tenantId,
        branchId,
      );

    return this.prisma.table.findMany({
      where: {
        tenantId,
        branchId: resolvedBranchId,
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
      orderBy: { number: "asc" },
    });
  }

  async findOne(scope: BranchScope, id: string) {
    const table = await this.prisma.table.findFirst({
      where: {
        id,
        ...branchScope(scope),
      },
      include: {
        orders: {
          where: {
            status: {
              notIn: [OrderStatus.PAID, OrderStatus.CANCELLED],
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!table) {
      throw new NotFoundException(`Table with ID ${id} not found`);
    }

    return table;
  }

  /**
   * Internal-only lookup that intentionally bypasses branch scope.
   * Use ONLY from system code paths that legitimately cross branches
   * (e.g. orphan-payment recovery in payments.service which is itself
   * tenant-scoped). HTTP handlers must use `findOne(scope, id)`.
   */
  async findOneByTenant(id: string, tenantId: string) {
    const table = await this.prisma.table.findFirst({
      where: { id, tenantId },
    });
    if (!table) {
      throw new NotFoundException(`Table with ID ${id} not found`);
    }
    return table;
  }

  async update(scope: BranchScope, id: string, updateTableDto: UpdateTableDto) {
    // Check if table exists and belongs to scope
    await this.findOne(scope, id);

    // If table number is being updated, check for conflicts
    if (updateTableDto.number) {
      // v3 branch-scope: collision is per (tenantId, branchId, number).
      const existingTable = await this.prisma.table.findUnique({
        where: {
          tenantId_branchId_number: {
            tenantId: scope.tenantId,
            branchId: scope.branchId,
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

    // Compound WHERE — IDOR guard (B41-B45 pattern). findOne above is
    // a TOCTOU check; the write also has to be (tenantId, branchId)-
    // scoped so a regression there can't leak into a cross-tenant or
    // cross-branch rename.
    const claim = await this.prisma.table.updateMany({
      where: { id, ...branchScope(scope) },
      data: updateTableDto,
    });
    if (claim.count === 0) {
      throw new NotFoundException("Table not found");
    }
    return this.prisma.table.findFirst({
      where: { id, ...branchScope(scope) },
    });
  }

  async updateStatus(
    scope: BranchScope,
    id: string,
    updateStatusDto: UpdateTableStatusDto,
  ) {
    // Atomic status transition with active-order guard. Without the
    // transaction + count check, two waiters clicking "Mark AVAILABLE"
    // moments apart can both succeed even if a new order was just
    // created — leaving the table free to be seated again while an
    // unpaid bill is still open.
    return this.prisma.$transaction(async (tx) => {
      const table = await tx.table.findFirst({
        where: { id, ...branchScope(scope) },
      });
      if (!table) throw new NotFoundException("Table not found");

      // Marking AVAILABLE must not happen while active orders are open.
      // The frontend already filters for this, but two concurrent waiters
      // or a stale snapshot can both submit — backend is the canonical
      // gatekeeper.
      if (updateStatusDto.status === TableStatus.AVAILABLE) {
        const activeOrders = await tx.order.count({
          where: {
            tableId: id,
            ...branchScope(scope),
            status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
          },
        });
        if (activeOrders > 0) {
          throw new ConflictException(
            "Cannot mark table AVAILABLE while it has active orders",
          );
        }
      }

      // Defense-in-depth: the findFirst above is a TOCTOU check; the write
      // must also be scope-bound so a future refactor that drops the
      // findFirst (or the ConflictException early-return) can't regress
      // into a cross-branch status overwrite.
      const claim = await tx.table.updateMany({
        where: { id, ...branchScope(scope) },
        data: { status: updateStatusDto.status },
      });
      if (claim.count === 0) throw new NotFoundException("Table not found");
      return tx.table.findFirstOrThrow({
        where: { id, ...branchScope(scope) },
      });
    });
  }

  async remove(scope: BranchScope, id: string) {
    // Atomic remove: verify scope ownership + count active orders + delete in
    // a single transaction so an order created between the count and the
    // delete can't orphan the FK.
    return this.prisma.$transaction(async (tx) => {
      const table = await tx.table.findFirst({
        where: { id, ...branchScope(scope) },
      });
      if (!table) throw new NotFoundException("Table not found");

      const activeOrders = await tx.order.count({
        where: {
          tableId: id,
          ...branchScope(scope),
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        },
      });
      if (activeOrders > 0) {
        throw new ConflictException("Cannot delete table with active orders");
      }
      // Compound WHERE on the delete (defense-in-depth — same as update/
      // updateStatus). deleteMany returns count rather than throwing so a
      // missing row is explicit; we re-raise as 404 to preserve the API.
      const claim = await tx.table.deleteMany({
        where: { id, ...branchScope(scope) },
      });
      if (claim.count === 0) throw new NotFoundException("Table not found");
      return { id };
    });
  }

  // ========================================
  // TABLE MERGE / SPLIT
  // ========================================

  async mergeTables(scope: BranchScope, dto: MergeTablesDto) {
    return this.prisma
      .$transaction(async (tx) => {
        // v3.0.0 — lookup is scope-bound so a MANAGER in branch A who
        // somehow obtains a branch-B tableId can't pull those tables into
        // their merge group. The lookup also surfaces the cross-branch
        // attempt as a 404 rather than a silent partial match.
        const tables = await tx.table.findMany({
          where: { id: { in: dto.tableIds }, ...branchScope(scope) },
        });

        if (tables.length !== dto.tableIds.length) {
          throw new NotFoundException(
            "One or more tables not found in current branch",
          );
        }

        // Cross-group merge protection. Previously a user picking one
        // table out of group A and one out of group B would silently
        // pull every member of both groups into a single new group.
        // That violates least-surprise — the user only selected 2
        // tables but ended up with a 10-table merge. Refuse instead;
        // operator must unmerge the existing groups first if that's
        // really what they want.
        const existingGroupIds = tables
          .map((t) => t.groupId)
          .filter(Boolean) as string[];
        const uniqueGroups = [...new Set(existingGroupIds)];

        if (uniqueGroups.length > 1) {
          throw new ConflictException(
            "One or more selected tables already belong to different merged groups. " +
              "Unmerge them first before creating a new merge.",
          );
        }

        // Use existing groupId if one of the tables is already in a group, otherwise create new
        const groupId =
          uniqueGroups.length > 0 ? uniqueGroups[0] : randomUUID();

        // Assign groupId to all requested tables
        await tx.table.updateMany({
          where: { id: { in: dto.tableIds }, ...branchScope(scope) },
          data: { groupId },
        });

        return {
          groupId,
          tableNumbers: tables.map((t) => t.number),
          branchId: tables[0].branchId,
        };
      })
      .then(({ groupId, tableNumbers, branchId }) => {
        this.kdsGateway.emitTableMerge(scope.tenantId, branchId, {
          groupId,
          tableNumbers,
        });
        return this.getTableGroup(scope, groupId);
      });
  }

  async unmergeTable(scope: BranchScope, dto: UnmergeTableDto) {
    return this.prisma
      .$transaction(async (tx) => {
        const table = await tx.table.findFirst({
          where: { id: dto.tableId, ...branchScope(scope) },
        });

        if (!table) {
          throw new NotFoundException("Table not found");
        }

        if (!table.groupId) {
          throw new BadRequestException("Table is not part of any group");
        }

        const groupId = table.groupId;

        // Compound WHERE — IDOR guard (B41-B45 pattern, same shape as
        // update() / updateStatus() / remove() above). The findFirst
        // above already proves ownership, but a future refactor that
        // hoists the early-return or condenses the txn shouldn't get to
        // silently leak into a cross-tenant/cross-branch write. Switching
        // to updateMany also gives us a count we can sanity-check.
        const detach = await tx.table.updateMany({
          where: { id: dto.tableId, ...branchScope(scope) },
          data: { groupId: null },
        });
        if (detach.count === 0) {
          throw new NotFoundException("Table not found");
        }

        // Check remaining group members
        const remaining = await tx.table.count({
          where: { groupId, ...branchScope(scope) },
        });

        // If only 1 table left, dissolve the group entirely
        if (remaining <= 1) {
          await tx.table.updateMany({
            where: { groupId, ...branchScope(scope) },
            data: { groupId: null },
          });
        }

        return {
          message: "Table unmerged successfully",
          tableId: dto.tableId,
          tableNumber: table.number,
          groupId,
          branchId: table.branchId,
        };
      })
      .then((result) => {
        this.kdsGateway.emitTableUnmerge(scope.tenantId, result.branchId, {
          tableNumber: result.tableNumber,
          groupId: result.groupId,
        });
        return { message: result.message, tableId: result.tableId };
      });
  }

  async unmergeAll(scope: BranchScope, groupId: string) {
    return this.prisma
      .$transaction(async (tx) => {
        const sampleTable = await tx.table.findFirst({
          where: { groupId, ...branchScope(scope) },
          select: { branchId: true },
        });
        const count = await tx.table.count({
          where: { groupId, ...branchScope(scope) },
        });

        if (count === 0) {
          throw new NotFoundException("No tables found in this group");
        }

        await tx.table.updateMany({
          where: { groupId, ...branchScope(scope) },
          data: { groupId: null },
        });

        return {
          message: "All tables unmerged successfully",
          branchId: sampleTable?.branchId ?? "",
        };
      })
      .then((result) => {
        this.kdsGateway.emitTableUnmerge(scope.tenantId, result.branchId, {
          tableNumber: "all",
          groupId,
        });
        return result;
      });
  }

  async getTableGroup(scope: BranchScope, groupId: string) {
    const tables = await this.prisma.table.findMany({
      where: { groupId, ...branchScope(scope) },
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
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { number: "asc" },
    });

    if (tables.length === 0) {
      throw new NotFoundException("Table group not found");
    }

    const allOrders = tables.flatMap((t) => t.orders);
    // Sum in Decimal so the bill summary doesn't drift on groups with
    // 10+ orders. The rest of the payments stack uses Prisma.Decimal
    // end-to-end; coercing to Number here would re-introduce the
    // float-precision drift the orders service spent effort avoiding.
    const totalAmount = allOrders.reduce(
      (sum, o) => sum.add(new Prisma.Decimal(o.finalAmount as any)),
      new Prisma.Decimal(0),
    );
    const totalPaid = allOrders.reduce(
      (sum, o) =>
        sum.add(
          o.payments
            .filter((p) => p.status === "COMPLETED")
            .reduce(
              (ps, p) => ps.add(new Prisma.Decimal(p.amount as any)),
              new Prisma.Decimal(0),
            ),
        ),
      new Prisma.Decimal(0),
    );

    return {
      groupId,
      tables: tables.map((t) => ({
        id: t.id,
        number: t.number,
        capacity: t.capacity,
        section: t.section,
        status: t.status,
      })),
      orders: allOrders,
      summary: {
        totalOrders: allOrders.length,
        totalAmount: totalAmount.toNumber(),
        totalPaid: totalPaid.toNumber(),
        remainingAmount: totalAmount.sub(totalPaid).toNumber(),
      },
    };
  }
}
