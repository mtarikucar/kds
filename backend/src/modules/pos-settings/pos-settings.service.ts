import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePosSettingsDto } from './dto/update-pos-settings.dto';

@Injectable()
export class PosSettingsService {
  constructor(private prisma: PrismaService) {}

  async findByTenant(tenantId: string) {
    let settings = await this.prisma.posSettings.findUnique({
      where: { tenantId },
    });

    // If no settings exist, create default settings
    if (!settings) {
      settings = await this.prisma.posSettings.create({
        data: {
          tenantId,
          enableTablelessMode: false,
          enableTwoStepCheckout: true, // Default to true for better workflow
          enableCustomerOrdering: true,
        },
      });
    }

    return settings;
  }

  async update(tenantId: string, updateDto: UpdatePosSettingsDto) {
    // Find existing settings or create if not exists
    let settings = await this.prisma.posSettings.findUnique({
      where: { tenantId },
    });

    if (!settings) {
      // Create new settings if they don't exist
      settings = await this.prisma.posSettings.create({
        data: {
          tenantId,
          enableTablelessMode: updateDto.enableTablelessMode ?? false,
          enableTwoStepCheckout: updateDto.enableTwoStepCheckout ?? true, // Default to true
          enableCustomerOrdering: updateDto.enableCustomerOrdering ?? true,
        },
      });
    } else {
      // Update existing settings
      settings = await this.prisma.posSettings.update({
        where: { tenantId },
        data: updateDto,
      });
    }

    return settings;
  }
}
