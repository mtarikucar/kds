import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../../../prisma/prisma.service';
import { Public } from '../../auth/decorators/public.decorator';

@ApiTags('qr-menu')
@Controller('qr-menu')
export class QrMenuController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get(':tenantId')
  @ApiOperation({ summary: 'Get public menu for QR code access (no authentication required)' })
  @ApiResponse({ status: 200, description: 'Public menu with categories and products' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async getPublicMenu(@Param('tenantId') tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      return { error: 'Tenant not found' };
    }

    const categories = await this.prisma.category.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      include: {
        products: {
          where: {
            isAvailable: true,
          },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            image: true,
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
      },
      categories,
    };
  }
}
