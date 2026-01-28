import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLayoutDto } from './dto/create-layout.dto';
import { UpdateLayoutDto } from './dto/update-layout.dto';

@Injectable()
export class LayoutsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenant(tenantId: string) {
    const layout = await this.prisma.restaurantLayout.findUnique({
      where: { tenantId },
    });

    if (!layout) {
      return this.createDefault(tenantId);
    }

    return layout;
  }

  async createDefault(tenantId: string) {
    return this.prisma.restaurantLayout.create({
      data: {
        tenantId,
        name: 'Main Floor',
        width: 32,
        height: 8,
        depth: 32,
        worldData: {
          objects: [],
          version: 1,
        },
      },
    });
  }

  async update(tenantId: string, updateLayoutDto: UpdateLayoutDto) {
    const existing = await this.prisma.restaurantLayout.findUnique({
      where: { tenantId },
    });

    if (!existing) {
      return this.prisma.restaurantLayout.create({
        data: {
          tenantId,
          name: updateLayoutDto.name ?? 'Main Floor',
          width: updateLayoutDto.width ?? 32,
          height: updateLayoutDto.height ?? 8,
          depth: updateLayoutDto.depth ?? 32,
          worldData: (updateLayoutDto.worldData ?? { objects: [], version: 1 }) as Prisma.InputJsonValue,
        },
      });
    }

    return this.prisma.restaurantLayout.update({
      where: { tenantId },
      data: {
        ...(updateLayoutDto.name && { name: updateLayoutDto.name }),
        ...(updateLayoutDto.width && { width: updateLayoutDto.width }),
        ...(updateLayoutDto.height && { height: updateLayoutDto.height }),
        ...(updateLayoutDto.depth && { depth: updateLayoutDto.depth }),
        ...(updateLayoutDto.worldData && { worldData: updateLayoutDto.worldData as Prisma.InputJsonValue }),
      },
    });
  }

  async updateTablePosition(
    tenantId: string,
    tableId: string,
    position: { x: number; y: number; z: number; rotation: number },
  ) {
    const table = await this.prisma.table.findFirst({
      where: {
        id: tableId,
        tenantId,
      },
    });

    if (!table) {
      throw new NotFoundException('Table not found');
    }

    return this.prisma.table.update({
      where: { id: tableId },
      data: {
        voxelX: position.x,
        voxelY: position.y,
        voxelZ: position.z,
        voxelRotation: position.rotation,
      },
    });
  }

  async getTablesWithPositions(tenantId: string) {
    return this.prisma.table.findMany({
      where: {
        tenantId,
        voxelX: { not: null },
      },
      select: {
        id: true,
        number: true,
        capacity: true,
        status: true,
        voxelX: true,
        voxelY: true,
        voxelZ: true,
        voxelRotation: true,
      },
    });
  }
}
