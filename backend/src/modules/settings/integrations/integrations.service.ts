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

  async getHardwareConfig(tenantId: string) {
    const hardwareTypes = [
      'THERMAL_PRINTER',
      'CASH_DRAWER',
      'RESTAURANT_PAGER',
      'BARCODE_READER',
      'CUSTOMER_DISPLAY',
      'KITCHEN_DISPLAY',
      'SCALE_DEVICE',
    ];

    const integrations = await this.prisma.integrationSettings.findMany({
      where: {
        tenantId,
        integrationType: { in: hardwareTypes },
        isEnabled: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Transform to format expected by Rust desktop app
    return {
      devices: integrations.map((integration) => ({
        id: integration.id,
        name: integration.provider,
        device_type: integration.integrationType,
        enabled: integration.isEnabled,
        auto_connect: (integration.config as any)?.auto_connect || true,
        connection: {
          connection_type: (integration.config as any)?.connection_type || 'Serial',
          config: (integration.config as any)?.connection_config || {},
        },
        settings: (integration.config as any)?.device_settings || {},
      })),
    };
  }

  async updateDeviceStatus(deviceId: string, tenantId: string, statusData: any) {
    const integration = await this.findOne(deviceId, tenantId);

    // Store device status in config
    const currentConfig = (integration.config as any) || {};
    const updatedConfig = {
      ...currentConfig,
      device_status: {
        ...statusData,
        last_updated: new Date(),
      },
    };

    await this.prisma.integrationSettings.update({
      where: { id: integration.id },
      data: {
        config: updatedConfig as any,
        lastSyncedAt: new Date(),
      },
    });

    return { success: true };
  }

  async reportDeviceEvent(deviceId: string, tenantId: string, eventData: any) {
    const integration = await this.findOne(deviceId, tenantId);

    // Log the event (could store in a separate events table in the future)
    console.log(`Hardware Event for device ${integration.provider}:`, eventData);

    // Update last sync time
    await this.prisma.integrationSettings.update({
      where: { id: integration.id },
      data: { lastSyncedAt: new Date() },
    });

    return { success: true };
  }
}
