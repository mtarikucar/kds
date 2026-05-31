import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateSmsSettingsDto } from './dto/update-sms-settings.dto';

@Injectable()
export class SmsSettingsService {
  constructor(private prisma: PrismaService) {}

  async findByTenant(tenantId: string) {
    return this.prisma.smsSettings.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId },
    });
  }

  async update(tenantId: string, updateDto: UpdateSmsSettingsDto) {
    return this.prisma.smsSettings.upsert({
      where: { tenantId },
      update: updateDto,
      create: { tenantId, ...updateDto },
    });
  }
}
