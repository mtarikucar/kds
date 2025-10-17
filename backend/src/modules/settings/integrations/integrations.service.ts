import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.integrationSettings.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByType(tenantId: string, integrationType: string) {
    return this.prisma.integrationSettings.findMany({
      where: { tenantId, integrationType },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const integration = await this.prisma.integrationSettings.findFirst({
      where: { id, tenantId },
    });

    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    return integration;
  }

  async create(tenantId: string, createDto: CreateIntegrationDto) {
    // Check if integration already exists
    const existing = await this.prisma.integrationSettings.findUnique({
      where: {
        tenantId_integrationType_provider: {
          tenantId,
          integrationType: createDto.integrationType,
          provider: createDto.provider,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'Integration with this type and provider already exists',
      );
    }

    return this.prisma.integrationSettings.create({
      data: {
        tenantId,
        ...createDto,
        isConfigured: true,
      },
    });
  }

  async update(id: string, tenantId: string, updateDto: UpdateIntegrationDto) {
    const integration = await this.findOne(id, tenantId);

    return this.prisma.integrationSettings.update({
      where: { id: integration.id },
      data: updateDto,
    });
  }

  async delete(id: string, tenantId: string) {
    const integration = await this.findOne(id, tenantId);

    return this.prisma.integrationSettings.delete({
      where: { id: integration.id },
    });
  }

  async toggleStatus(id: string, tenantId: string, isEnabled: boolean) {
    const integration = await this.findOne(id, tenantId);

    return this.prisma.integrationSettings.update({
      where: { id: integration.id },
      data: { isEnabled },
    });
  }

  async updateLastSync(id: string, tenantId: string) {
    const integration = await this.findOne(id, tenantId);

    return this.prisma.integrationSettings.update({
      where: { id: integration.id },
      data: { lastSyncedAt: new Date() },
    });
  }
}
