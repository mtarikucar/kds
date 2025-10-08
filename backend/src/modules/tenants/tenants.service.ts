import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async create(createTenantDto: CreateTenantDto) {
    // Check if subdomain is already in use
    if (createTenantDto.subdomain) {
      const existingTenant = await this.prisma.tenant.findUnique({
        where: { subdomain: createTenantDto.subdomain },
      });

      if (existingTenant) {
        throw new ConflictException('Subdomain already in use');
      }
    }

    return this.prisma.tenant.create({
      data: {
        name: createTenantDto.name,
        subdomain: createTenantDto.subdomain,
        plan: createTenantDto.plan || 'FREE',
        status: createTenantDto.status || 'ACTIVE',
      },
    });
  }

  async findAll() {
    return this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            users: true,
            products: true,
            orders: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: true,
            categories: true,
            products: true,
            tables: true,
            orders: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${id} not found`);
    }

    return tenant;
  }

  async update(id: string, updateTenantDto: UpdateTenantDto) {
    // Check if tenant exists
    await this.findOne(id);

    // Check if subdomain is already in use by another tenant
    if (updateTenantDto.subdomain) {
      const existingTenant = await this.prisma.tenant.findUnique({
        where: { subdomain: updateTenantDto.subdomain },
      });

      if (existingTenant && existingTenant.id !== id) {
        throw new ConflictException('Subdomain already in use');
      }
    }

    return this.prisma.tenant.update({
      where: { id },
      data: updateTenantDto,
    });
  }

  async remove(id: string) {
    // Check if tenant exists
    await this.findOne(id);

    return this.prisma.tenant.delete({
      where: { id },
    });
  }
}
