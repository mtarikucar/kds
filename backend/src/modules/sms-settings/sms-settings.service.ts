import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { UpdateSmsSettingsDto } from "./dto/update-sms-settings.dto";

@Injectable()
export class SmsSettingsService {
  constructor(private prisma: PrismaService) {}

  // v3.0.1 — findFirst + opportunistic create instead of upsert. The
  // tenant-default row keys on (tenantId, null); Prisma's upsert
  // rejects the compound-unique branchId: null even though the DB
  // constraint allows it. See branch-scope.ts loadBranchSettings note.
  async findByTenant(tenantId: string) {
    const existing = await this.prisma.smsSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    if (existing) return existing;
    try {
      return await this.prisma.smsSettings.create({ data: { tenantId } });
    } catch (e: any) {
      if (e?.code === "P2002") {
        const row = await this.prisma.smsSettings.findFirst({
          where: { tenantId, branchId: null },
        });
        if (row) return row;
      }
      throw e;
    }
  }

  async update(tenantId: string, updateDto: UpdateSmsSettingsDto) {
    const existing = await this.prisma.smsSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    if (existing) {
      const updated = await this.prisma.smsSettings.updateMany({
        where: { tenantId, branchId: null },
        data: updateDto,
      });
      if (updated.count > 0) {
        return this.prisma.smsSettings.findFirstOrThrow({
          where: { tenantId, branchId: null },
        });
      }
    }
    try {
      return await this.prisma.smsSettings.create({
        data: { tenantId, ...updateDto },
      });
    } catch (e: any) {
      if (e?.code === "P2002") {
        await this.prisma.smsSettings.updateMany({
          where: { tenantId, branchId: null },
          data: updateDto,
        });
        return this.prisma.smsSettings.findFirstOrThrow({
          where: { tenantId, branchId: null },
        });
      }
      throw e;
    }
  }
}
