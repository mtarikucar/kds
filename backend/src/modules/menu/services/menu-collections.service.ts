import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  CreateMenuCollectionDto,
  UpdateMenuCollectionDto,
} from "../dto/menu-collection.dto";

/** Tenant-scoped CRUD for menu collections (classification, spec §3/§9). */
@Injectable()
export class MenuCollectionsService {
  constructor(private prisma: PrismaService) {}

  // Turkish-aware slugify: fold ç/ğ/ı/ö/ş/ü, lowercase, non-alnum → single "-".
  private slugify(input: string): string {
    const map: Record<string, string> = {
      ç: "c",
      ğ: "g",
      ı: "i",
      İ: "i",
      ö: "o",
      ş: "s",
      ü: "u",
    };
    const folded = input
      .replace(/[çğıİöşü]/g, (m) => map[m] ?? m)
      .toLowerCase();
    const slug = folded
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "koleksiyon";
  }

  private async uniqueSlug(
    tenantId: string,
    base: string,
    excludeId?: string,
  ): Promise<string> {
    let candidate = base;
    for (let i = 2; i < 100; i++) {
      const clash = await this.prisma.menuCollection.findFirst({
        where: {
          tenantId,
          slug: candidate,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true },
      });
      if (!clash) return candidate;
      candidate = `${base}-${i}`;
    }
    // Extremely unlikely — 98 same-named collections. Fall back to a suffix.
    return `${base}-${Date.now()}`;
  }

  async create(dto: CreateMenuCollectionDto, tenantId: string) {
    const base = dto.slug ? dto.slug : this.slugify(dto.name);
    const slug = await this.uniqueSlug(tenantId, base);
    return this.prisma.menuCollection.create({
      data: {
        tenantId,
        name: dto.name,
        slug,
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findAll(tenantId: string) {
    const rows = await this.prisma.menuCollection.findMany({
      where: { tenantId },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { products: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      displayOrder: r.displayOrder,
      isActive: r.isActive,
      productCount: r._count.products,
    }));
  }

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.menuCollection.findFirst({
      where: { id, tenantId },
      include: {
        products: {
          orderBy: { displayOrder: "asc" },
          select: {
            productId: true,
            product: { select: { id: true, name: true, image: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException("Koleksiyon bulunamadı");
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      displayOrder: row.displayOrder,
      isActive: row.isActive,
      products: row.products.map((p) => p.product),
    };
  }

  async update(id: string, dto: UpdateMenuCollectionDto, tenantId: string) {
    const existing = await this.prisma.menuCollection.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Koleksiyon bulunamadı");

    const data: Prisma.MenuCollectionUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.slug !== undefined) {
      data.slug = await this.uniqueSlug(tenantId, dto.slug, id);
    }
    // Defence-in-depth: tenantId in the WHERE (updateMany) so a pre-check
    // regression can't write cross-tenant.
    const claim = await this.prisma.menuCollection.updateMany({
      where: { id, tenantId },
      data,
    });
    if (claim.count === 0)
      throw new BadRequestException("Koleksiyon bulunamadı");
    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string) {
    // ProductCollection rows cascade with the collection (onDelete: Cascade),
    // so removing a collection just un-classifies its products — it never
    // touches the products themselves.
    const claim = await this.prisma.menuCollection.deleteMany({
      where: { id, tenantId },
    });
    if (claim.count === 0) throw new NotFoundException("Koleksiyon bulunamadı");
    return { success: true };
  }
}
