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

  /** Allocate qty units to an order line item — also pops serials when present. */
  async allocate(productId: string, qty: number, tx?: Prisma.TransactionClient) {
    const client = (tx ?? this.prisma) as Prisma.TransactionClient | PrismaService;
    const inv = await client.hardwareInventory.findUnique({ where: { productId } });
    if (!inv) throw new NotFoundException('No inventory row for product');
    if (inv.available < qty) {
      throw new BadRequestException(`Insufficient stock: have ${inv.available}, need ${qty}`);
    }
    const popped = inv.serialsAvailable.slice(0, qty);
    const remaining = inv.serialsAvailable.slice(popped.length);

    await client.hardwareInventory.update({
      where: { productId },
      data: {
        available: { decrement: qty },
        allocated: { increment: qty },
        serialsAvailable: remaining,
      },
    });
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
