import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Hardware product catalog. The public store reads `published` rows; the
 * super-admin UI manages everything. Inventory rows are kept in lockstep
 * with products — every product gets an empty inventory row on create.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublic(filters?: { category?: string }) {
    return this.prisma.hardwareProduct.findMany({
      where: { status: 'published', ...(filters?.category ? { category: filters.category } : {}) },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async listAdmin(filters?: { status?: string; category?: string }) {
    return this.prisma.hardwareProduct.findMany({
      where: {
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.category ? { category: filters.category } : {}),
      },
      include: { inventory: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async findOrThrow(id: string) {
    const row = await this.prisma.hardwareProduct.findUnique({
      where: { id },
      include: { inventory: true },
    });
    if (!row) throw new NotFoundException('Product not found');
    return row;
  }

  async findBySkuOrThrow(sku: string) {
    const row = await this.prisma.hardwareProduct.findUnique({
      where: { sku },
      include: { inventory: true },
    });
    if (!row) throw new NotFoundException(`SKU not found: ${sku}`);
    return row;
  }

  async create(input: {
    sku: string;
    category: string;
    name: string;
    brand?: string;
    model?: string;
    description?: string;
    specs?: Record<string, unknown>;
    compat?: Record<string, unknown>;
    priceCents: number;
    rentalMonthlyCents?: number;
    currency?: string;
    warrantyMonths?: number;
    images?: string[];
    shippingProfile?: Record<string, unknown>;
    status?: string;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.hardwareProduct.create({
          data: {
            sku: input.sku,
            category: input.category,
            name: input.name,
            brand: input.brand,
            model: input.model,
            description: input.description,
            specs: input.specs as any,
            compat: input.compat as any,
            priceCents: input.priceCents,
            rentalMonthlyCents: input.rentalMonthlyCents,
            currency: input.currency ?? 'TRY',
            warrantyMonths: input.warrantyMonths ?? 12,
            images: input.images ?? [],
            shippingProfile: input.shippingProfile as any,
            status: input.status ?? 'draft',
          },
        });
        await tx.hardwareInventory.create({ data: { productId: product.id } });
        return product;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`SKU exists: ${input.sku}`);
      }
      throw e;
    }
  }

  async update(id: string, input: Partial<Omit<Parameters<CatalogService['create']>[0], 'sku'>>) {
    const exists = await this.prisma.hardwareProduct.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Product not found');
    return this.prisma.hardwareProduct.update({
      where: { id },
      data: {
        category: input.category,
        name: input.name,
        brand: input.brand,
        model: input.model,
        description: input.description,
        specs: input.specs as any,
        compat: input.compat as any,
        priceCents: input.priceCents,
        rentalMonthlyCents: input.rentalMonthlyCents,
        currency: input.currency,
        warrantyMonths: input.warrantyMonths,
        images: input.images,
        shippingProfile: input.shippingProfile as any,
        status: input.status,
      },
    });
  }

  async archive(id: string) {
    // Reject archive while there are unfulfilled order lines pointing at
    // this product. Otherwise the fulfillment workflow (packing slips,
    // shipping labels, warranty registration) hits a hidden product and
    // either silently shows blanks or fails at render time. Operators
    // should either ship those orders first or cancel them.
    //
    // "Pending" here = the HardwareOrder is not yet delivered/installed/
    // refunded — the FK from items to orders gives us the order status
    // for the eligibility check.
    const pending = await this.prisma.hardwareOrderItem.count({
      where: {
        productId: id,
        order: { status: { notIn: ['delivered', 'installed', 'refunded', 'returned', 'cancelled'] } },
      },
    });
    if (pending > 0) {
      throw new BadRequestException(
        `Cannot archive — ${pending} unfulfilled order line(s) reference this product. Ship or cancel them first.`,
      );
    }
    return this.update(id, { status: 'archived' });
  }

  /** Inventory ops — adjust stock and serials in one place to keep totals consistent. */
  async receiveStock(productId: string, qty: number, serials?: string[]) {
    if (qty < 1) throw new BadRequestException('qty must be ≥ 1');
    return this.prisma.hardwareInventory.update({
      where: { productId },
      data: {
        available: { increment: qty },
        ...(serials && serials.length > 0
          ? { serialsAvailable: { push: serials.slice(0, qty) } }
          : {}),
      },
    });
  }

  /**
   * Atomically check-and-decrement stock for an order line. Without this
   * being a single statement, two concurrent checkouts each read the same
   * `available` count and both decrement — overselling by 1×qty.
   *
   * `updateMany` with the `available >= qty` guard is atomic in Postgres:
   * the rowlock + WHERE clause ensures only one transaction sees the row
   * as eligible. Count=0 on return means another checkout claimed it
   * first, so we throw a 409-style BadRequest with the current stock.
   *
   * Serial allocation happens in a second read after the decrement
   * commits — at that point the row is exclusively ours, so a plain
   * read + update of the remaining serials is race-free.
   */
  async allocate(productId: string, qty: number, tx?: Prisma.TransactionClient) {
    const client = (tx ?? this.prisma) as Prisma.TransactionClient | PrismaService;

    const claim = await client.hardwareInventory.updateMany({
      where: { productId, available: { gte: qty } },
      data: {
        available: { decrement: qty },
        allocated: { increment: qty },
      },
    });
    if (claim.count === 0) {
      const inv = await client.hardwareInventory.findUnique({ where: { productId } });
      if (!inv) throw new NotFoundException('No inventory row for product');
      throw new BadRequestException(`Insufficient stock: have ${inv.available}, need ${qty}`);
    }

    // Pop serials post-claim. Re-reading is cheap (single row) and we know
    // we own the decrement at this point.
    const inv = await client.hardwareInventory.findUnique({ where: { productId } });
    const popped = inv!.serialsAvailable.slice(0, qty);
    if (popped.length > 0) {
      const remaining = inv!.serialsAvailable.slice(popped.length);
      await client.hardwareInventory.update({
        where: { productId },
        data: { serialsAvailable: remaining },
      });
    }
    return { serials: popped };
  }

  /** When a shipment leaves: allocated → shipped. */
  async markShipped(productId: string, qty: number) {
    return this.prisma.hardwareInventory.update({
      where: { productId },
      data: {
        allocated: { decrement: qty },
        shipped: { increment: qty },
      },
    });
  }
}
