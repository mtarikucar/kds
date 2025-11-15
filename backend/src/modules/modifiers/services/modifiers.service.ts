import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateModifierGroupDto } from '../dto/create-modifier-group.dto';
import { UpdateModifierGroupDto } from '../dto/update-modifier-group.dto';
import { CreateModifierDto } from '../dto/create-modifier.dto';
import { UpdateModifierDto } from '../dto/update-modifier.dto';
import { AssignModifiersToProductDto } from '../dto/assign-modifiers.dto';

@Injectable()
export class ModifiersService {
  constructor(private prisma: PrismaService) {}

  // ========================================
  // MODIFIER GROUPS
  // ========================================

  async createGroup(dto: CreateModifierGroupDto, tenantId: string) {
    return this.prisma.modifierGroup.create({
      data: {
        ...dto,
        tenantId,
      },
      include: {
        modifiers: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
  }

  async findAllGroups(tenantId: string, includeInactive = false) {
    return this.prisma.modifierGroup.findMany({
      where: {
        tenantId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        modifiers: {
          where: includeInactive ? {} : { isAvailable: true },
          orderBy: { displayOrder: 'asc' },
        },
        _count: {
          select: {
            productMappings: true,
          },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async findOneGroup(id: string, tenantId: string) {
    const group = await this.prisma.modifierGroup.findFirst({
      where: { id, tenantId },
      include: {
        modifiers: {
          orderBy: { displayOrder: 'asc' },
        },
        productMappings: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
              },
            },
          },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Modifier group not found');
    }

    return group;
  }

  async updateGroup(id: string, dto: UpdateModifierGroupDto, tenantId: string) {
    await this.findOneGroup(id, tenantId);

    return this.prisma.modifierGroup.update({
      where: { id },
      data: dto,
      include: {
        modifiers: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
  }

  async deleteGroup(id: string, tenantId: string) {
    await this.findOneGroup(id, tenantId);

    // Check if group is assigned to any products
    const productCount = await this.prisma.productModifierGroup.count({
      where: { groupId: id },
    });

    if (productCount > 0) {
      throw new BadRequestException(
        `Cannot delete modifier group. It is assigned to ${productCount} product(s).`
      );
    }

    await this.prisma.modifierGroup.delete({
      where: { id },
    });

    return { message: 'Modifier group deleted successfully' };
  }

  // ========================================
  // MODIFIERS
  // ========================================

  async createModifier(dto: CreateModifierDto, tenantId: string) {
    // Verify group exists and belongs to tenant
    const group = await this.prisma.modifierGroup.findFirst({
      where: {
        id: dto.groupId,
        tenantId,
      },
    });

    if (!group) {
      throw new BadRequestException(
        'Invalid modifier group or group does not belong to your tenant'
      );
    }

    return this.prisma.modifier.create({
      data: {
        ...dto,
        tenantId,
      },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            displayName: true,
          },
        },
      },
    });
  }

  async findAllModifiers(tenantId: string, groupId?: string, includeUnavailable = false) {
    return this.prisma.modifier.findMany({
      where: {
        tenantId,
        ...(groupId ? { groupId } : {}),
        ...(includeUnavailable ? {} : { isAvailable: true }),
      },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            displayName: true,
          },
        },
      },
      orderBy: [
        { groupId: 'asc' },
        { displayOrder: 'asc' },
      ],
    });
  }

  async findOneModifier(id: string, tenantId: string) {
    const modifier = await this.prisma.modifier.findFirst({
      where: { id, tenantId },
      include: {
        group: true,
      },
    });

    if (!modifier) {
      throw new NotFoundException('Modifier not found');
    }

    return modifier;
  }

  async updateModifier(id: string, dto: UpdateModifierDto, tenantId: string) {
    await this.findOneModifier(id, tenantId);

    return this.prisma.modifier.update({
      where: { id },
      data: dto,
      include: {
        group: {
          select: {
            id: true,
            name: true,
            displayName: true,
          },
        },
      },
    });
  }

  async deleteModifier(id: string, tenantId: string) {
    await this.findOneModifier(id, tenantId);

    // Check if modifier is used in any orders
    const orderItemCount = await this.prisma.orderItemModifier.count({
      where: { modifierId: id },
    });

    if (orderItemCount > 0) {
      throw new BadRequestException(
        `Cannot delete modifier. It has been used in ${orderItemCount} order item(s).`
      );
    }

    await this.prisma.modifier.delete({
      where: { id },
    });

    return { message: 'Modifier deleted successfully' };
  }

  // ========================================
  // PRODUCT-MODIFIER ASSIGNMENTS
  // ========================================

  async assignModifiersToProduct(
    productId: string,
    dto: AssignModifiersToProductDto,
    tenantId: string
  ) {
    // Verify product exists and belongs to tenant
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Verify all groups exist and belong to tenant
    const groupIds = dto.modifierGroups.map(mg => mg.groupId);
    const groups = await this.prisma.modifierGroup.findMany({
      where: {
        id: { in: groupIds },
        tenantId,
      },
    });

    if (groups.length !== groupIds.length) {
      throw new BadRequestException('One or more modifier groups are invalid');
    }

    // Remove existing assignments
    await this.prisma.productModifierGroup.deleteMany({
      where: { productId },
    });

    // Create new assignments
    await this.prisma.productModifierGroup.createMany({
      data: dto.modifierGroups.map(mg => ({
        productId,
        groupId: mg.groupId,
        displayOrder: mg.displayOrder || 0,
      })),
    });

    // Return updated product with modifiers
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        modifierGroups: {
          include: {
            group: {
              include: {
                modifiers: {
                  where: { isAvailable: true },
                  orderBy: { displayOrder: 'asc' },
                },
              },
            },
          },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
  }

  async getProductModifiers(productId: string, tenantId: string) {
    // Verify product exists and belongs to tenant
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.productModifierGroup.findMany({
      where: { productId },
      include: {
        group: {
          include: {
            modifiers: {
              where: { isAvailable: true },
              orderBy: { displayOrder: 'asc' },
            },
          },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async removeModifierGroupFromProduct(
    productId: string,
    groupId: string,
    tenantId: string
  ) {
    // Verify product exists and belongs to tenant
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    await this.prisma.productModifierGroup.deleteMany({
      where: {
        productId,
        groupId,
      },
    });

    return { message: 'Modifier group removed from product successfully' };
  }
}
