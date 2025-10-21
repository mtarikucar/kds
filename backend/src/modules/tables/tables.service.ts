import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTableDto, TableStatus } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { OrderStatus } from '../../common/constants/order-status.enum';

@Injectable()
export class TablesService {
  constructor(private prisma: PrismaService) {}

  async create(createTableDto: CreateTableDto, tenantId: string) {
    // Check if table number already exists for this tenant
    const existingTable = await this.prisma.table.findUnique({
      where: {
        tenantId_number: {
          tenantId,
          number: createTableDto.number,
        },
      },
    });

    if (existingTable) {
      throw new ConflictException(
        `Table number ${createTableDto.number} already exists`,
      );
    }

    return this.prisma.table.create({
      data: {
        number: createTableDto.number,
        capacity: createTableDto.capacity,
        section: createTableDto.section,
        status: createTableDto.status || TableStatus.AVAILABLE,
        tenantId,
      },
    });
  }

  async findAll(tenantId: string, section?: string) {
    const where: any = { tenantId };
    if (section) {
      where.section = section;
    }

    return this.prisma.table.findMany({
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
      orderBy: { number: 'asc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const table = await this.prisma.table.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        orders: {
          where: {
            status: {
              notIn: [OrderStatus.PAID, OrderStatus.CANCELLED],
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!table) {
      throw new NotFoundException(`Table with ID ${id} not found`);
    }

    return table;
  }

  async update(id: string, updateTableDto: UpdateTableDto, tenantId: string) {
    // Check if table exists and belongs to tenant
    await this.findOne(id, tenantId);

    // If table number is being updated, check for conflicts
    if (updateTableDto.number) {
      const existingTable = await this.prisma.table.findUnique({
        where: {
          tenantId_number: {
            tenantId,
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

    return this.prisma.table.update({
      where: { id },
      data: updateTableDto,
    });
  }

  async updateStatus(id: string, updateStatusDto: UpdateTableStatusDto, tenantId: string) {
    // Check if table exists and belongs to tenant
    await this.findOne(id, tenantId);

    return this.prisma.table.update({
      where: { id },
      data: {
        status: updateStatusDto.status,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    // Check if table exists and belongs to tenant
    const table = await this.findOne(id, tenantId);

    // Check if table has active orders
    const activeOrders = await this.prisma.order.count({
      where: {
        tableId: id,
        status: {
          notIn: [OrderStatus.PAID, OrderStatus.CANCELLED],
        },
      },
    });

    if (activeOrders > 0) {
      throw new ConflictException(
        'Cannot delete table with active orders',
      );
    }

    return this.prisma.table.delete({
      where: { id },
    });
  }
}
