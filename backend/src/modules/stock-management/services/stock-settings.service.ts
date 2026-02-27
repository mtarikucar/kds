import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateStockSettingsDto } from '../dto/update-stock-settings.dto';

@Injectable()
export class StockSettingsService {
  constructor(private prisma: PrismaService) {}

  async get(tenantId: string) {
    let settings = await this.prisma.stockSettings.findUnique({
      where: { tenantId },
    });

    if (!settings) {
      settings = await this.prisma.stockSettings.create({
        data: { tenantId },
      });
    }

    return settings;
  }

  async update(dto: UpdateStockSettingsDto, tenantId: string) {
    return this.prisma.stockSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...dto },
      update: dto,
    });
  }
}
