import { Controller, Get, Post, Patch, Delete, Body, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';
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
    // Get frontend URL from environment or construct from request
    let baseUrl = process.env.FRONTEND_URL;

    if (!baseUrl) {
      // Fallback: Try to construct from request
      const protocol = req.protocol || 'http';
      const host = req.get('host') || 'localhost:3000';

      // If backend is on :3000, assume frontend is on :5173 (Vite default)
      // If backend is on different port, use same host
      if (host.includes(':3000')) {
        baseUrl = `${protocol}://${host.replace(':3000', ':5173')}`;
      } else if (host.includes('localhost') || host.includes('127.0.0.1')) {
        baseUrl = 'http://localhost:5173';
      } else {
        // Production or custom domain - use same domain
        baseUrl = `${protocol}://${host}`;
      }
    }

    return this.qrService.getQrCodes(req.tenantId, baseUrl);
  }
}
