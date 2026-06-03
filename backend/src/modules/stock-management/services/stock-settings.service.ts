import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { UpdateStockSettingsDto } from "../dto/update-stock-settings.dto";

@Injectable()
export class StockSettingsService {
  constructor(private prisma: PrismaService) {}

  // v3.0.1 — findFirst pattern (see branch-scope.ts loadBranchSettings
  // note). Prisma's findUnique/upsert rejects compound-unique with
  // `branchId: null`, even when the DB constraint allows NULL.
  async get(tenantId: string) {
    const existing = await this.prisma.stockSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    if (existing) return existing;
    try {
      return await this.prisma.stockSettings.create({ data: { tenantId } });
    } catch (e: any) {
      if (e?.code === "P2002") {
        const row = await this.prisma.stockSettings.findFirst({
          where: { tenantId, branchId: null },
        });
        if (row) return row;
      }
      throw e;
    }
  }

  async update(dto: UpdateStockSettingsDto, tenantId: string) {
    const existing = await this.prisma.stockSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    if (existing) {
      const updated = await this.prisma.stockSettings.updateMany({
        where: { tenantId, branchId: null },
        data: dto,
      });
      if (updated.count > 0) {
        return this.prisma.stockSettings.findFirstOrThrow({
          where: { tenantId, branchId: null },
        });
      }
    }
    try {
      return await this.prisma.stockSettings.create({
        data: { tenantId, ...dto },
      });
    } catch (e: any) {
      if (e?.code === "P2002") {
        await this.prisma.stockSettings.updateMany({
          where: { tenantId, branchId: null },
          data: dto,
        });
        return this.prisma.stockSettings.findFirstOrThrow({
          where: { tenantId, branchId: null },
        });
      }
      throw e;
    }
  }
}
