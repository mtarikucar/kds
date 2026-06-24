import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { KdsGateway } from "../kds/kds.gateway";
import { TablesService } from "./tables.service";
import { BranchScope, branchScope } from "../../common/scoping/branch-scope";
import { OrderStatus } from "../../common/constants/order-status.enum";
import {
  CreateFloorZoneDto,
  UpdateFloorZoneDto,
  ReorderZonesDto,
} from "./dto/floor-zone.dto";
import {
  CreateFloorElementDto,
  UpdateFloorElementDto,
} from "./dto/floor-element.dto";
import { SaveLayoutDto } from "./dto/save-layout.dto";

// Defensive growth ceilings so a scripted ADMIN/MANAGER can't accumulate an
// unbounded number of zones/elements one-per-request (the per-request array
// caps in SaveLayoutDto only bound a single save). getPlan eagerly loads the
// whole plan, so these keep that payload sane.
const MAX_ZONES_PER_BRANCH = 100;
const MAX_ELEMENTS_PER_ZONE = 2_000;

/**
 * Owns the 2D floor-plan model: zones (kat/bahçe/teras), the decorative /
 * structural elements placed on them, and bulk persistence of a drag/resize
 * session. Table identity/CRUD stays in TablesService; this service only
 * touches a table's spatial placement (zone + geometry).
 *
 * Every mutation is (tenantId, branchId)-scoped via a compound WHERE — the
 * same IDOR guard the table mutations use — so a MANAGER scoped to branch A
 * can never read or move branch B's plan.
 */
@Injectable()
export class FloorPlanService {
  constructor(
    private prisma: PrismaService,
    private kdsGateway: KdsGateway,
    // Reused to attach `upcomingReservation` to placed/unplaced tables so the
    // floor-plan read matches the legacy GET /tables shape (one source of
    // truth for the reservation-hold badge).
    private tables: TablesService,
  ) {}

  private readonly ACTIVE_ORDER_FILTER = {
    status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
  };

  /**
   * The whole plan for the current branch: every zone (sorted) with its
   * elements and placed tables, plus the tables not yet placed on any zone
   * (the editor's "unplaced" tray). Tables carry an `activeOrderCount` so the
   * live map can badge busy tables without a second request.
   */
  async getPlan(scope: BranchScope) {
    const [zones, tables] = await Promise.all([
      this.prisma.floorZone.findMany({
        where: { ...branchScope(scope) },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          elements: { orderBy: { zIndex: "asc" } },
        },
      }),
      this.prisma.table.findMany({
        where: { ...branchScope(scope) },
        orderBy: { number: "asc" },
        include: {
          _count: { select: { orders: { where: this.ACTIVE_ORDER_FILTER } } },
        },
      }),
    ]);

    // Attach the next reservation-hold badge to each table (same window logic
    // the legacy /tables list uses) so the live map can render it without a
    // second request — required by the P1 endpoint contract.
    const annotated = await this.tables.withUpcomingReservations(scope, tables);
    const zoneIdSet = new Set(zones.map((z) => z.id));

    const shape = (t: (typeof annotated)[number]) => ({
      id: t.id,
      number: t.number,
      capacity: t.capacity,
      status: t.status,
      groupId: t.groupId,
      zoneId: t.zoneId,
      posX: t.posX,
      posY: t.posY,
      width: t.width,
      height: t.height,
      rotation: t.rotation,
      tableShape: t.shape,
      activeOrderCount: t._count.orders,
      upcomingReservation: t.upcomingReservation ?? null,
    });

    const placedByZone = new Map<string, ReturnType<typeof shape>[]>();
    const unplaced: ReturnType<typeof shape>[] = [];
    for (const t of annotated) {
      // A table only counts as "placed" if its zone is actually in the returned
      // set. If a concurrent deleteZone removed the zone between the two reads,
      // the table falls back to the unplaced tray rather than silently
      // vanishing from the plan entirely.
      if (t.zoneId && zoneIdSet.has(t.zoneId)) {
        const list = placedByZone.get(t.zoneId) ?? [];
        list.push(shape(t));
        placedByZone.set(t.zoneId, list);
      } else {
        unplaced.push(shape(t));
      }
    }

    return {
      zones: zones.map((z) => ({
        ...z,
        tables: placedByZone.get(z.id) ?? [],
      })),
      unplacedTables: unplaced,
    };
  }

  async createZone(scope: BranchScope, dto: CreateFloorZoneDto) {
    await this.assertZoneNameFree(scope, dto.name);

    const zoneCount = await this.prisma.floorZone.count({
      where: { ...branchScope(scope) },
    });
    if (zoneCount >= MAX_ZONES_PER_BRANCH) {
      throw new ConflictException(
        `A branch can have at most ${MAX_ZONES_PER_BRANCH} floor zones`,
      );
    }

    // Append after the current last zone so a new zone shows up at the end of
    // the tab strip rather than fighting for sortOrder 0.
    const last = await this.prisma.floorZone.findFirst({
      where: { ...branchScope(scope) },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const zone = await this.prisma.floorZone.create({
      data: {
        name: dto.name,
        kind: dto.kind ?? "INDOOR",
        canvasWidth: dto.canvasWidth ?? 1200,
        canvasHeight: dto.canvasHeight ?? 800,
        gridSize: dto.gridSize ?? 20,
        backgroundImageUrl: dto.backgroundImageUrl,
        backgroundOpacity: dto.backgroundOpacity ?? 1,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        tenantId: scope.tenantId,
        branchId: scope.branchId,
      },
    });
    this.kdsGateway.emitFloorLayoutUpdated(scope.tenantId, scope.branchId, {});
    return zone;
  }

  async updateZone(scope: BranchScope, id: string, dto: UpdateFloorZoneDto) {
    const existing = await this.prisma.floorZone.findFirst({
      where: { id, ...branchScope(scope) },
    });
    if (!existing) throw new NotFoundException("Floor zone not found");

    if (dto.name && dto.name !== existing.name) {
      await this.assertZoneNameFree(scope, dto.name);
    }

    const claim = await this.prisma.floorZone.updateMany({
      where: { id, ...branchScope(scope) },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.canvasWidth !== undefined
          ? { canvasWidth: dto.canvasWidth }
          : {}),
        ...(dto.canvasHeight !== undefined
          ? { canvasHeight: dto.canvasHeight }
          : {}),
        ...(dto.gridSize !== undefined ? { gridSize: dto.gridSize } : {}),
        ...(dto.backgroundImageUrl !== undefined
          ? { backgroundImageUrl: dto.backgroundImageUrl }
          : {}),
        ...(dto.backgroundOpacity !== undefined
          ? { backgroundOpacity: dto.backgroundOpacity }
          : {}),
      },
    });
    if (claim.count === 0) throw new NotFoundException("Floor zone not found");
    this.kdsGateway.emitFloorLayoutUpdated(scope.tenantId, scope.branchId, {
      zoneId: id,
    });
    return this.prisma.floorZone.findFirst({
      where: { id, ...branchScope(scope) },
    });
  }

  /**
   * Delete a zone. Its tables are NOT deleted — they fall back to the
   * unplaced tray (zoneId → null via the FK's ON DELETE SET NULL, mirrored
   * here explicitly so it's scope-bound and obvious). Its elements are
   * removed (FK cascade). Runs in one transaction.
   */
  async deleteZone(scope: BranchScope, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const zone = await tx.floorZone.findFirst({
        where: { id, ...branchScope(scope) },
      });
      if (!zone) throw new NotFoundException("Floor zone not found");

      await tx.table.updateMany({
        where: { zoneId: id, ...branchScope(scope) },
        data: { zoneId: null },
      });
      await tx.floorElement.deleteMany({
        where: { zoneId: id, ...branchScope(scope) },
      });
      const claim = await tx.floorZone.deleteMany({
        where: { id, ...branchScope(scope) },
      });
      if (claim.count === 0)
        throw new NotFoundException("Floor zone not found");
    });
    this.kdsGateway.emitFloorLayoutUpdated(scope.tenantId, scope.branchId, {});
    return { id };
  }

  async reorderZones(scope: BranchScope, dto: ReorderZonesDto) {
    const results = await this.prisma.$transaction(
      dto.zones.map((z) =>
        this.prisma.floorZone.updateMany({
          where: { id: z.id, ...branchScope(scope) },
          data: { sortOrder: z.sortOrder },
        }),
      ),
    );
    // Report the rows that actually moved, not the request size — a stale /
    // cross-branch id is a scope-safe no-op (count 0) and must not be counted
    // as reordered, nor trigger a spurious live-map refresh.
    const reordered = results.reduce((n, r) => n + r.count, 0);
    if (reordered > 0) {
      this.kdsGateway.emitFloorLayoutUpdated(
        scope.tenantId,
        scope.branchId,
        {},
      );
    }
    return { reordered };
  }

  async createElement(scope: BranchScope, dto: CreateFloorElementDto) {
    await this.assertZoneInScope(scope, dto.zoneId);

    const elementCount = await this.prisma.floorElement.count({
      where: { zoneId: dto.zoneId, ...branchScope(scope) },
    });
    if (elementCount >= MAX_ELEMENTS_PER_ZONE) {
      throw new ConflictException(
        `A zone can have at most ${MAX_ELEMENTS_PER_ZONE} elements`,
      );
    }

    const element = await this.prisma.floorElement.create({
      data: {
        zoneId: dto.zoneId,
        type: dto.type,
        x: dto.x ?? 0,
        y: dto.y ?? 0,
        width: dto.width ?? 100,
        height: dto.height ?? 100,
        rotation: dto.rotation ?? 0,
        points: dto.points ?? undefined,
        style: dto.style ?? undefined,
        label: dto.label,
        zIndex: dto.zIndex ?? 0,
        tenantId: scope.tenantId,
        branchId: scope.branchId,
      },
    });
    this.kdsGateway.emitFloorLayoutUpdated(scope.tenantId, scope.branchId, {
      zoneId: dto.zoneId,
    });
    return element;
  }

  async updateElement(
    scope: BranchScope,
    id: string,
    dto: UpdateFloorElementDto,
  ) {
    const existing = await this.prisma.floorElement.findFirst({
      where: { id, ...branchScope(scope) },
    });
    if (!existing) throw new NotFoundException("Floor element not found");

    // Moving an element to another zone must stay within the branch.
    if (dto.zoneId && dto.zoneId !== existing.zoneId) {
      await this.assertZoneInScope(scope, dto.zoneId);
    }

    const claim = await this.prisma.floorElement.updateMany({
      where: { id, ...branchScope(scope) },
      data: {
        ...(dto.zoneId !== undefined ? { zoneId: dto.zoneId } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.x !== undefined ? { x: dto.x } : {}),
        ...(dto.y !== undefined ? { y: dto.y } : {}),
        ...(dto.width !== undefined ? { width: dto.width } : {}),
        ...(dto.height !== undefined ? { height: dto.height } : {}),
        ...(dto.rotation !== undefined ? { rotation: dto.rotation } : {}),
        ...(dto.points !== undefined ? { points: dto.points } : {}),
        ...(dto.style !== undefined ? { style: dto.style } : {}),
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.zIndex !== undefined ? { zIndex: dto.zIndex } : {}),
      },
    });
    if (claim.count === 0)
      throw new NotFoundException("Floor element not found");
    this.kdsGateway.emitFloorLayoutUpdated(scope.tenantId, scope.branchId, {
      zoneId: dto.zoneId ?? existing.zoneId,
    });
    return this.prisma.floorElement.findFirst({
      where: { id, ...branchScope(scope) },
    });
  }

  async deleteElement(scope: BranchScope, id: string) {
    const existing = await this.prisma.floorElement.findFirst({
      where: { id, ...branchScope(scope) },
      select: { zoneId: true },
    });
    if (!existing) throw new NotFoundException("Floor element not found");
    await this.prisma.floorElement.deleteMany({
      where: { id, ...branchScope(scope) },
    });
    this.kdsGateway.emitFloorLayoutUpdated(scope.tenantId, scope.branchId, {
      zoneId: existing.zoneId,
    });
    return { id };
  }

  /**
   * Persist a full editor drag/resize session in one transaction: each
   * table's zone + geometry and each touched element's geometry. Only rows
   * that belong to this branch are written (compound WHERE), and any target
   * zoneId is validated to be in-branch first so a layout payload can't
   * reparent a table into another branch's zone.
   */
  async saveLayout(scope: BranchScope, dto: SaveLayoutDto) {
    const elements = dto.elements ?? [];

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Validate every distinct target zone INSIDE the transaction so the
        // existence check and the writes share one snapshot — a concurrent
        // deleteZone can't slip the zone out from under a validated placement.
        const zoneIds = [
          ...new Set(
            dto.tables
              .map((t) => t.zoneId)
              .filter(
                (z): z is string => typeof z === "string" && z.length > 0,
              ),
          ),
        ];
        if (zoneIds.length > 0) {
          const found = await tx.floorZone.findMany({
            where: { id: { in: zoneIds }, ...branchScope(scope) },
            select: { id: true },
          });
          if (found.length !== zoneIds.length) {
            throw new NotFoundException(
              "One or more target zones do not exist in this branch",
            );
          }
        }

        let tableCount = 0;
        for (const t of dto.tables) {
          const claim = await tx.table.updateMany({
            where: { id: t.id, ...branchScope(scope) },
            data: {
              zoneId: t.zoneId ?? null,
              posX: t.posX,
              posY: t.posY,
              width: t.width,
              height: t.height,
              rotation: t.rotation,
              shape: t.shape,
            },
          });
          tableCount += claim.count;
        }
        // Fail closed: a table id that is foreign / stale / since-deleted
        // matches 0 rows. Rather than silently dropping it and returning a
        // success the editor trusts (lost drag-save), reject the whole
        // transaction — matching updateZone/updateElement which 404 on no
        // match. The compound WHERE already makes cross-branch ids no-ops, so
        // this only converts an invisible loss into an explicit failure.
        if (tableCount !== dto.tables.length) {
          throw new NotFoundException(
            "One or more tables were not found in this branch — nothing was saved",
          );
        }

        let elementCount = 0;
        for (const e of elements) {
          const claim = await tx.floorElement.updateMany({
            where: { id: e.id, ...branchScope(scope) },
            data: {
              x: e.x,
              y: e.y,
              width: e.width,
              height: e.height,
              rotation: e.rotation,
              ...(e.points !== undefined ? { points: e.points } : {}),
              ...(e.style !== undefined ? { style: e.style } : {}),
            },
          });
          elementCount += claim.count;
        }
        if (elementCount !== elements.length) {
          throw new NotFoundException(
            "One or more elements were not found in this branch — nothing was saved",
          );
        }
        return { tableCount, elementCount };
      },
      // A full drag-session save can touch many rows; give the interactive
      // transaction a generous budget so a large (but in-cap) layout doesn't
      // trip Prisma's default 5s timeout (P2028 → rollback). Still bounded by
      // the SaveLayoutDto array caps.
      { timeout: 30_000, maxWait: 10_000 },
    );

    this.kdsGateway.emitFloorLayoutUpdated(scope.tenantId, scope.branchId, {});
    return result;
  }

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  private async assertZoneNameFree(scope: BranchScope, name: string) {
    const clash = await this.prisma.floorZone.findFirst({
      where: { ...branchScope(scope), name },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(`A zone named "${name}" already exists`);
    }
  }

  private async assertZoneInScope(scope: BranchScope, zoneId: string) {
    const zone = await this.prisma.floorZone.findFirst({
      where: { id: zoneId, ...branchScope(scope) },
      select: { id: true },
    });
    if (!zone) {
      throw new NotFoundException("Floor zone not found in this branch");
    }
  }
}
