import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { CreateStockItemDto } from "../dto/create-stock-item.dto";
import { UpdateStockItemDto } from "../dto/update-stock-item.dto";
import { StockItemQueryDto } from "../dto/stock-item-query.dto";
import { Prisma } from "@prisma/client";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";

@Injectable()
export class StockItemsService {
  constructor(private prisma: PrismaService) {}

  async findAll(scope: BranchScope, query: StockItemQueryDto) {
    const where: Prisma.StockItemWhereInput = { ...branchScope(scope) };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { sku: { contains: query.search, mode: "insensitive" } },
      ];
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const orderBy: Prisma.StockItemOrderByWithRelationInput = {};
    if (query.sortBy) {
      orderBy[query.sortBy] = query.sortOrder || "asc";
    } else {
      orderBy.name = "asc";
    }

    return this.prisma.stockItem.findMany({
      where,
      include: { category: true },
      orderBy,
    });
  }

  async findOne(id: string, scope: BranchScope) {
    const item = await this.prisma.stockItem.findFirst({
      where: { id, ...branchScope(scope) },
      include: {
        category: true,
        batches: {
          where: { quantity: { gt: 0 } },
          orderBy: { expiryDate: "asc" },
        },
        supplierStockItems: { include: { supplier: true } },
      },
    });
    if (!item) throw new NotFoundException("Stock item not found");
    return item;
  }

  async create(dto: CreateStockItemDto, tenantId: string, branchId: string) {
    return this.prisma.stockItem.create({
      // v3 branch-scope: SKU uniqueness is the compound
      // @@unique([tenantId, branchId, sku]) — branch A and branch B may
      // each carry SKU "COKE". Empty-string SKU still collides within a
      // branch while null is allowed to repeat, so normalise to null here.
      data: { ...dto, sku: dto.sku ? dto.sku : null, tenantId, branchId },
      include: { category: true },
    });
  }

  async update(id: string, dto: UpdateStockItemDto, scope: BranchScope) {
    await this.findOne(id, scope);
    const data = "sku" in dto ? { ...dto, sku: dto.sku ? dto.sku : null } : dto;
    // Defence-in-depth: branch filter in the update's own WHERE so the
    // pre-check can't be the *only* scope guard. updateMany + count
    // check (TOCTOU-safe) — if the row was deleted between the pre-check
    // and the update, we throw instead of silently failing.
    const result = await this.prisma.stockItem.updateMany({
      where: { id, ...branchScope(scope) },
      data,
    });
    if (result.count === 0) {
      throw new NotFoundException("Stock item not found");
    }
    return this.prisma.stockItem.findUnique({
      where: { id },
      include: { category: true },
    });
  }

  async remove(id: string, scope: BranchScope) {
    await this.findOne(id, scope);

    // Prevent deletion of stock items used in active recipes (scope the
    // recipe lookup to the same branch — a recipe in another branch must
    // not be able to block this branch's delete, nor leak its name).
    const recipeUsage = await this.prisma.recipeIngredient.findFirst({
      where: { stockItemId: id, recipe: { ...branchScope(scope) } },
      include: { recipe: { select: { name: true } } },
    });
    if (recipeUsage) {
      throw new BadRequestException(
        `Cannot delete: stock item is used in recipe "${recipeUsage.recipe.name}"`,
      );
    }

    // Compound-filter delete — see comment in update().
    const result = await this.prisma.stockItem.deleteMany({
      where: { id, ...branchScope(scope) },
    });
    if (result.count === 0) {
      throw new NotFoundException("Stock item not found");
    }
    return { id };
  }

  async findLowStockItems(scope: BranchScope) {
    // Use raw query for comparing two columns. Branch-fenced: both the
    // tenantId AND branchId predicates are bound parameters so a
    // low-stock list never bleeds another branch's items.
    return this.prisma.$queryRaw`
      SELECT si.*, sic.name as "categoryName"
      FROM stock_items si
      LEFT JOIN stock_item_categories sic ON si."categoryId" = sic.id
      WHERE si."tenantId" = ${scope.tenantId}
        AND si."branchId" = ${scope.branchId}
        AND si."isActive" = true
        AND si."currentStock" <= si."minStock"
      ORDER BY si."currentStock" ASC
    `;
  }

  async findExpiringSoon(scope: BranchScope, days: number = 3) {
    const alertDate = new Date();
    alertDate.setDate(alertDate.getDate() + days);

    // v2.8.94 — also gate on stockItem.trackExpiry. The expiryDate
    // {lte, gte} pair already excludes NULL-expiry rows (PostgreSQL
    // returns false for any range comparison with NULL), but a data
    // migration glitch that stamps an expiryDate onto a non-perishable
    // SKU would still leak it into the alert feed. Filtering by the
    // explicit `trackExpiry=true` flag keeps the alert noise scoped
    // to SKUs the operator actually opted into expiry tracking for.
    return this.prisma.stockBatch.findMany({
      where: {
        ...branchScope(scope),
        quantity: { gt: 0 },
        expiryDate: { lte: alertDate, gte: new Date() },
        stockItem: { trackExpiry: true },
      },
      include: { stockItem: true },
      orderBy: { expiryDate: "asc" },
    });
  }
}
