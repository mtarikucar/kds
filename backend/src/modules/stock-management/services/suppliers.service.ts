import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSupplierDto, UpdateSupplierDto, SupplierStockItemDto } from '../dto/create-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.supplier.findMany({
      where: { tenantId },
      include: {
        _count: { select: { supplierStockItems: true, purchaseOrders: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
      include: {
        supplierStockItems: {
          include: { stockItem: { select: { id: true, name: true, unit: true } } },
        },
        _count: { select: { purchaseOrders: true } },
      },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async create(dto: CreateSupplierDto, tenantId: string) {
    return this.prisma.supplier.create({
      data: { ...dto, tenantId },
    });
  }

  async update(id: string, dto: UpdateSupplierDto, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.supplier.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    // Check if supplier has any non-cancelled POs
    const activePOs = await this.prisma.purchaseOrder.count({
      where: { supplierId: id, status: { notIn: ['CANCELLED', 'RECEIVED'] } },
    });
    if (activePOs > 0) {
      throw new BadRequestException('Cannot delete supplier with active purchase orders');
    }
    return this.prisma.supplier.delete({ where: { id } });
  }

  async addStockItem(supplierId: string, dto: SupplierStockItemDto, tenantId: string) {
    await this.findOne(supplierId, tenantId);

    const stockItem = await this.prisma.stockItem.findFirst({
      where: { id: dto.stockItemId, tenantId },
    });
    if (!stockItem) throw new BadRequestException('Stock item not found');

    return this.prisma.supplierStockItem.upsert({
      where: { supplierId_stockItemId: { supplierId, stockItemId: dto.stockItemId } },
      create: {
        supplierId,
        stockItemId: dto.stockItemId,
        supplierSku: dto.supplierSku,
        unitPrice: dto.unitPrice,
        isPreferred: dto.isPreferred || false,
      },
      update: {
        supplierSku: dto.supplierSku,
        unitPrice: dto.unitPrice,
        isPreferred: dto.isPreferred,
      },
      include: { stockItem: { select: { id: true, name: true, unit: true } } },
    });
  }

  async removeStockItem(supplierId: string, stockItemId: string, tenantId: string) {
    await this.findOne(supplierId, tenantId);
    return this.prisma.supplierStockItem.delete({
      where: { supplierId_stockItemId: { supplierId, stockItemId } },
    });
  }
}
