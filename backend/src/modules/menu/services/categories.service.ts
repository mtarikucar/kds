import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { CreateCategoryDto } from "../dto/create-category.dto";
import { UpdateCategoryDto } from "../dto/update-category.dto";
import { sanitizePage } from "../../../common/dto/list-query.dto";

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async create(createCategoryDto: CreateCategoryDto, tenantId: string) {
    return this.prisma.category.create({
      data: {
        name: createCategoryDto.name,
        description: createCategoryDto.description,
        displayOrder: createCategoryDto.displayOrder ?? 0,
        isActive: createCategoryDto.isActive ?? true,
        tenantId,
      },
    });
  }

  async findAll(
    tenantId: string,
    pagination?: { limit?: number; offset?: number },
  ) {
    // ADDITIVE pagination (Wave-C). Omitted limit/offset => undefined =>
    // Prisma returns the full list (byte-identical default). sanitizePage
    // collapses junk values to undefined so a bad query can't 500.
    const { take, skip } = sanitizePage(pagination);
    return this.prisma.category.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
      orderBy: { displayOrder: "asc" },
      take,
      skip,
    });
  }

  async findOne(id: string, tenantId: string) {
    const category = await this.prisma.category.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        products: {
          orderBy: { name: "asc" },
        },
      },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    return category;
  }

  async update(
    id: string,
    updateCategoryDto: UpdateCategoryDto,
    tenantId: string,
  ) {
    // Check if category exists and belongs to tenant
    await this.findOne(id, tenantId);

    // Compound WHERE — IDOR guard (B41-B45 pattern).
    const claim = await this.prisma.category.updateMany({
      where: { id, tenantId },
      data: updateCategoryDto,
    });
    if (claim.count === 0) {
      throw new ConflictException("Category not found");
    }
    // Defence-in-depth — the updateMany above proved tenant ownership,
    // but a refactor that reorders steps would see an id-only read and
    // miss the constraint. Same pattern iter-9 closed across tables/
    // suppliers/stock-categories.
    return this.prisma.category.findFirstOrThrow({ where: { id, tenantId } });
  }

  async remove(id: string, tenantId: string) {
    // Product → Category FK is `onDelete: Cascade` in the schema. The
    // ad-hoc count → delete pattern is racy: a product created between
    // the count read and the delete would be silently cascaded away
    // when the category drops. We run the count + delete inside one
    // SERIALIZABLE transaction so a concurrent product insert either
    // (a) commits before us and trips the count guard, or (b) hits
    // the serialization conflict and rolls back. Either outcome is
    // safe; no product gets silently destroyed.
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const category = await tx.category.findFirst({
            where: { id, tenantId },
            include: { _count: { select: { products: true } } },
          });
          if (!category)
            throw new NotFoundException(`Category with ID ${id} not found`);
          if (category._count.products > 0) {
            throw new ConflictException(
              "Cannot delete category with existing products. Please delete or reassign products first.",
            );
          }
          return tx.category.delete({ where: { id, tenantId } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      // SERIALIZATION_FAILURE (40001) → P2034 in Prisma. Surface as 409
      // so the client retries (the typical UX is a "Try again" button).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2034"
      ) {
        throw new ConflictException(
          "Category was modified concurrently — refresh and try again.",
        );
      }
      throw err;
    }
  }
}
