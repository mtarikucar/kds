import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DesktopAppService } from './desktop-app.service';

const VERSION_REGEX = /^v?\d+\.\d+\.\d+$/;
const PLATFORM_REGEX = /^[a-z0-9-]{1,32}$/i;
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
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('updates/:platform/:currentVersion')
  @ApiOperation({ summary: 'Check for updates - Used by Tauri app' })
  @ApiResponse({ status: 204, description: 'No update available' })
  async checkForUpdates(
    @Param('platform') platform: string,
    @Param('currentVersion') currentVersion: string,
  ): Promise<UpdateManifestDto | null> {
    if (!PLATFORM_REGEX.test(platform)) {
      throw new BadRequestException('Invalid platform');
    }
    if (!VERSION_REGEX.test(currentVersion)) {
      throw new BadRequestException('Invalid version');
    }
    const manifest = await this.desktopAppService.checkForUpdates(platform, currentVersion);
    return manifest ?? null;
  }

  /**
   * Get latest published release (public)
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
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
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
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
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('releases/:version/download/:platform')
  @ApiOperation({ summary: 'Track a download for analytics' })
  async trackDownload(
    @Param('version') version: string,
    @Param('platform') platform: string,
  ): Promise<{ message: string }> {
    if (!VERSION_REGEX.test(version)) {
      throw new BadRequestException('Invalid version');
    }
    if (!PLATFORM_REGEX.test(platform)) {
      throw new BadRequestException('Invalid platform');
    }
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
  // @Public() skips the global JwtAuthGuard. ApiKeyGuard no longer honors
  // IS_PUBLIC_KEY (was the bypass bug), so the endpoint still enforces the
  // DESKTOP_RELEASE_API_KEY header.
  @Public()
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
  @Public()
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
