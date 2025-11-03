import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { DesktopAppService } from './desktop-app.service';
import { CreateReleaseDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
import { UpdateManifestDto } from './dto/update-manifest.dto';
import { DesktopRelease } from './entities/desktop-release.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UserRole } from '../../common/constants/roles.enum';

@ApiTags('desktop-app')
@Controller('desktop')
export class DesktopAppController {
  constructor(private readonly desktopAppService: DesktopAppService) {}

  // ===========================================
  // PUBLIC ENDPOINTS (No Auth Required)
  // ===========================================

  /**
   * Check for updates (Tauri updater endpoint)
   */
  @Public()
  @Get('updates/:platform/:currentVersion')
  @ApiOperation({ summary: 'Check for updates - Used by Tauri app' })
  @ApiParam({ name: 'platform', example: 'windows-x86_64', description: 'Target platform' })
  @ApiParam({ name: 'currentVersion', example: '0.2.6', description: 'Current app version' })
  @ApiResponse({
    status: 200,
    description: 'Update manifest returned',
    type: UpdateManifestDto,
  })
  @ApiResponse({ status: 204, description: 'No update available' })
  async checkForUpdates(
    @Param('platform') platform: string,
    @Param('currentVersion') currentVersion: string,
  ): Promise<UpdateManifestDto | null> {
    const manifest = await this.desktopAppService.checkForUpdates(platform, currentVersion);

    if (!manifest) {
      return null; // NestJS will return 204 No Content
    }

    return manifest;
  }

  /**
   * Get latest published release (public)
   */
  @Public()
  @Get('releases/latest')
  @ApiOperation({ summary: 'Get latest published release' })
  @ApiResponse({ status: 200, description: 'Latest release', type: DesktopRelease })
  @ApiResponse({ status: 404, description: 'No published releases' })
  async getLatestRelease(): Promise<DesktopRelease> {
    return this.desktopAppService.findLatest();
  }

  /**
   * Get all published releases (public)
   */
  @Public()
  @Get('releases/published')
  @ApiOperation({ summary: 'Get all published releases' })
  @ApiResponse({ status: 200, description: 'List of published releases', type: [DesktopRelease] })
  async getPublishedReleases(): Promise<DesktopRelease[]> {
    return this.desktopAppService.findPublished();
  }

  /**
   * Track download (public, for analytics)
   */
  @Public()
  @Post('releases/:version/download/:platform')
  @ApiOperation({ summary: 'Track a download for analytics' })
  @ApiParam({ name: 'version', example: '0.2.6' })
  @ApiParam({ name: 'platform', example: 'windows' })
  @ApiResponse({ status: 200, description: 'Download tracked' })
  async trackDownload(
    @Param('version') version: string,
    @Param('platform') platform: string,
  ): Promise<{ message: string }> {
    await this.desktopAppService.trackDownload(version, platform);
    return { message: 'Download tracked' };
  }

  // ===========================================
  // CI/CD ENDPOINTS (API Key Required)
  // ===========================================

  /**
   * Create a new release via CI/CD (API Key required)
   * Used by GitHub Actions for automated releases
   */
  @Post('ci/releases')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Create a new desktop release via CI/CD (API Key)' })
  @ApiResponse({ status: 201, description: 'Release created', type: DesktopRelease })
  @ApiResponse({ status: 400, description: 'Bad request - Version exists' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid API Key' })
  async createReleaseCI(@Body() createReleaseDto: CreateReleaseDto): Promise<DesktopRelease> {
    return this.desktopAppService.create(createReleaseDto);
  }

  /**
   * Publish a release via CI/CD (API Key required)
   * Used by GitHub Actions for automated publishing
   */
  @Post('ci/releases/:id/publish')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Publish a release via CI/CD (API Key)' })
  @ApiResponse({ status: 200, description: 'Release published', type: DesktopRelease })
  @ApiResponse({ status: 400, description: 'Already published' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid API Key' })
  @ApiResponse({ status: 404, description: 'Release not found' })
  async publishReleaseCI(@Param('id') id: string): Promise<DesktopRelease> {
    return this.desktopAppService.publish(id);
  }

  // ===========================================
  // ADMIN ENDPOINTS (Auth + Admin Role Required)
  // ===========================================

  /**
   * Create a new release (admin only)
   */
  @Post('releases')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new desktop release (Admin)' })
  @ApiResponse({ status: 201, description: 'Release created', type: DesktopRelease })
  @ApiResponse({ status: 400, description: 'Bad request - Version exists' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  async createRelease(@Body() createReleaseDto: CreateReleaseDto): Promise<DesktopRelease> {
    return this.desktopAppService.create(createReleaseDto);
  }

  /**
   * Get all releases including unpublished (admin only)
   */
  @Get('releases')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all releases including drafts (Admin)' })
  @ApiResponse({ status: 200, description: 'List of all releases', type: [DesktopRelease] })
  async getAllReleases(): Promise<DesktopRelease[]> {
    return this.desktopAppService.findAll();
  }

  /**
   * Get release by ID (admin only)
   */
  @Get('releases/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get release by ID (Admin)' })
  @ApiResponse({ status: 200, description: 'Release found', type: DesktopRelease })
  @ApiResponse({ status: 404, description: 'Release not found' })
  async getReleaseById(@Param('id') id: string): Promise<DesktopRelease> {
    return this.desktopAppService.findOne(id);
  }

  /**
   * Update a release (admin only)
   */
  @Patch('releases/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a release (Admin)' })
  @ApiResponse({ status: 200, description: 'Release updated', type: DesktopRelease })
  @ApiResponse({ status: 404, description: 'Release not found' })
  async updateRelease(
    @Param('id') id: string,
    @Body() updateReleaseDto: UpdateReleaseDto,
  ): Promise<DesktopRelease> {
    return this.desktopAppService.update(id, updateReleaseDto);
  }

  /**
   * Publish a release (admin only)
   */
  @Post('releases/:id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish a release (Admin)' })
  @ApiResponse({ status: 200, description: 'Release published', type: DesktopRelease })
  @ApiResponse({ status: 400, description: 'Already published' })
  @ApiResponse({ status: 404, description: 'Release not found' })
  async publishRelease(@Param('id') id: string): Promise<DesktopRelease> {
    return this.desktopAppService.publish(id);
  }

  /**
   * Unpublish a release (admin only)
   */
  @Post('releases/:id/unpublish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unpublish a release (Admin)' })
  @ApiResponse({ status: 200, description: 'Release unpublished', type: DesktopRelease })
  @ApiResponse({ status: 400, description: 'Not published' })
  @ApiResponse({ status: 404, description: 'Release not found' })
  async unpublishRelease(@Param('id') id: string): Promise<DesktopRelease> {
    return this.desktopAppService.unpublish(id);
  }

  /**
   * Delete a release (admin only)
   */
  @Delete('releases/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a release (Admin)' })
  @ApiResponse({ status: 200, description: 'Release deleted' })
  @ApiResponse({ status: 404, description: 'Release not found' })
  async deleteRelease(@Param('id') id: string): Promise<{ message: string }> {
    return this.desktopAppService.remove(id);
  }
}
