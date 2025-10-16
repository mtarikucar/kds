import { Controller, Get, Post, Patch, Delete, Body, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { QrService } from './qr.service';
import { CreateQrSettingsDto } from './dto/create-qr-settings.dto';
import { UpdateQrSettingsDto } from './dto/update-qr-settings.dto';

@ApiTags('qr')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('qr')
export class QrController {
  constructor(private qrService: QrService) {}

  @Get('settings')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get QR menu settings for current tenant' })
  @ApiResponse({ status: 200, description: 'QR settings retrieved successfully' })
  getSettings(@Request() req) {
    return this.qrService.getSettings(req.tenantId);
  }

  @Post('settings')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create QR menu settings' })
  @ApiResponse({ status: 201, description: 'QR settings created successfully' })
  createSettings(@Request() req, @Body() dto: CreateQrSettingsDto) {
    return this.qrService.createSettings(req.tenantId, dto);
  }

  @Patch('settings')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update QR menu settings' })
  @ApiResponse({ status: 200, description: 'QR settings updated successfully' })
  updateSettings(@Request() req, @Body() dto: UpdateQrSettingsDto) {
    return this.qrService.updateSettings(req.tenantId, dto);
  }

  @Delete('settings')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete QR menu settings (reset to defaults)' })
  @ApiResponse({ status: 200, description: 'QR settings deleted successfully' })
  deleteSettings(@Request() req) {
    return this.qrService.deleteSettings(req.tenantId);
  }

  @Get('codes')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all QR codes (tenant and tables) with data URLs' })
  @ApiResponse({ status: 200, description: 'QR codes generated successfully' })
  getQrCodes(@Request() req) {
    // Get base URL from environment or request
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const host = req.get('host') || 'localhost:5173';
    const baseUrl = `${protocol}://${host.replace(':3000', ':5173')}`;

    return this.qrService.getQrCodes(req.tenantId, baseUrl);
  }
}
