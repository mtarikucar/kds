import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

    // Note: Tableless mode and customer ordering can now work together
    // - With tableId: DINE_IN order (customer scans table QR)
    // - Without tableId (tableless mode): COUNTER order (customer orders without table)

    // Validation: Customer ordering requires two-step checkout
    if (updateDto.enableCustomerOrdering === true) {
      const willHaveTwoStepCheckout =
        updateDto.enableTwoStepCheckout !== undefined
          ? updateDto.enableTwoStepCheckout
          : settings?.enableTwoStepCheckout ?? true;

      if (!willHaveTwoStepCheckout) {
        throw new BadRequestException(
          'İki aşamalı ödeme, QR menüden müşteri sipariş oluşturma için zorunludur. ' +
          'Lütfen önce iki aşamalı ödemeyi etkinleştirin.'
        );
      }
    }

    // Validation: Cannot disable two-stage payment if customer ordering is active
    if (updateDto.enableTwoStepCheckout === false) {
      const willHaveCustomerOrdering =
        updateDto.enableCustomerOrdering !== undefined
          ? updateDto.enableCustomerOrdering
          : settings?.enableCustomerOrdering ?? true;

      if (willHaveCustomerOrdering) {
        throw new BadRequestException(
          'QR menü sipariş aktifken iki aşamalı ödeme kapatılamaz. ' +
          'Lütfen önce QR menüden müşteri sipariş oluşturmayı kapatın.'
        );
      }
    }

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
