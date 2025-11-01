import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReleaseDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
import { UpdateManifestDto, PlatformManifest } from './dto/update-manifest.dto';

@Injectable()
export class DesktopAppService {
  private readonly logger = new Logger(DesktopAppService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create a new desktop release
   */
  async create(createReleaseDto: CreateReleaseDto) {
    // Check if version already exists
    const existing = await this.prisma.desktopRelease.findUnique({
      where: { version: createReleaseDto.version },
    });

    if (existing) {
      throw new BadRequestException(`Release version ${createReleaseDto.version} already exists`);
    }

    const release = await this.prisma.desktopRelease.create({
      data: {
        ...createReleaseDto,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Created desktop release: ${release.version}`);
    return release;
  }

  /**
   * Get all releases (admin)
   */
  async findAll() {
    return this.prisma.desktopRelease.findMany({
      orderBy: { pubDate: 'desc' },
    });
  }

  /**
   * Get published releases only (public)
   */
  async findPublished() {
    return this.prisma.desktopRelease.findMany({
      where: { published: true },
      orderBy: { pubDate: 'desc' },
    });
  }

  /**
   * Get latest published release
   */
  async findLatest() {
    const release = await this.prisma.desktopRelease.findFirst({
      where: { published: true },
      orderBy: { pubDate: 'desc' },
    });

    if (!release) {
      throw new NotFoundException('No published releases found');
    }

    return release;
  }

  /**
   * Get release by ID
   */
  async findOne(id: string) {
    const release = await this.prisma.desktopRelease.findUnique({
      where: { id },
    });

    if (!release) {
      throw new NotFoundException(`Release with ID ${id} not found`);
    }

    return release;
  }

  /**
   * Get release by version
   */
  async findByVersion(version: string) {
    const release = await this.prisma.desktopRelease.findUnique({
      where: { version },
    });

    if (!release) {
      throw new NotFoundException(`Release version ${version} not found`);
    }

    return release;
  }

  /**
   * Update a release
   */
  async update(id: string, updateReleaseDto: UpdateReleaseDto) {
    await this.findOne(id); // Check if exists

    const updated = await this.prisma.desktopRelease.update({
      where: { id },
      data: {
        ...updateReleaseDto,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Updated desktop release: ${updated.version}`);
    return updated;
  }

  /**
   * Publish a release
   */
  async publish(id: string) {
    const release = await this.findOne(id);

    if (release.published) {
      throw new BadRequestException('Release is already published');
    }

    const updated = await this.prisma.desktopRelease.update({
      where: { id },
      data: {
        published: true,
        pubDate: new Date(),
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Published desktop release: ${updated.version}`);
    return updated;
  }

  /**
   * Unpublish a release
   */
  async unpublish(id: string) {
    const release = await this.findOne(id);

    if (!release.published) {
      throw new BadRequestException('Release is not published');
    }

    const updated = await this.prisma.desktopRelease.update({
      where: { id },
      data: {
        published: false,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Unpublished desktop release: ${updated.version}`);
    return updated;
  }

  /**
   * Delete a release
   */
  async remove(id: string) {
    await this.findOne(id); // Check if exists

    await this.prisma.desktopRelease.delete({
      where: { id },
    });

    this.logger.log(`Deleted desktop release: ${id}`);
    return { message: 'Release deleted successfully' };
  }

  /**
   * Track download for analytics
   */
  async trackDownload(version: string, platform: string) {
    try {
      await this.prisma.desktopRelease.update({
        where: { version },
        data: {
          downloadCount: {
            increment: 1,
          },
        },
      });

      this.logger.log(`Tracked download: ${version} - ${platform}`);
    } catch (error) {
      // Don't throw error for tracking - just log
      this.logger.warn(`Failed to track download: ${error.message}`);
    }
  }

  /**
   * Check for updates (Tauri updater endpoint)
   * Returns update manifest if newer version available
   */
  async checkForUpdates(platform: string, currentVersion: string): Promise<UpdateManifestDto | null> {
    // Get latest published release
    const latestRelease = await this.prisma.desktopRelease.findFirst({
      where: { published: true },
      orderBy: { pubDate: 'desc' },
    });

    if (!latestRelease) {
      return null;
    }

    // Compare versions (simple string comparison for now)
    // In production, use semver library for proper comparison
    if (this.compareVersions(latestRelease.version, currentVersion) <= 0) {
      // No update available (current version is same or newer)
      return null;
    }

    // Build platform manifests
    const platforms: UpdateManifestDto['platforms'] = {};

    if (latestRelease.windowsUrl && latestRelease.windowsSignature) {
      platforms['windows-x86_64'] = {
        url: latestRelease.windowsUrl,
        signature: latestRelease.windowsSignature,
      };
    }

    if (latestRelease.macArmUrl && latestRelease.macArmSignature) {
      platforms['darwin-aarch64'] = {
        url: latestRelease.macArmUrl,
        signature: latestRelease.macArmSignature,
      };
    }

    if (latestRelease.macIntelUrl && latestRelease.macIntelSignature) {
      platforms['darwin-x86_64'] = {
        url: latestRelease.macIntelUrl,
        signature: latestRelease.macIntelSignature,
      };
    }

    if (latestRelease.linuxUrl && latestRelease.linuxSignature) {
      platforms['linux-x86_64'] = {
        url: latestRelease.linuxUrl,
        signature: latestRelease.linuxSignature,
      };
    }

    // Check if requested platform is available
    const platformKey = this.normalizePlatform(platform);
    if (!platforms[platformKey]) {
      this.logger.warn(`Platform ${platform} not available for version ${latestRelease.version}`);
      return null;
    }

    const manifest: UpdateManifestDto = {
      version: latestRelease.version,
      notes: latestRelease.releaseNotes,
      pub_date: latestRelease.pubDate.toISOString(),
      platforms,
    };

    return manifest;
  }

  /**
   * Simple version comparison (use semver in production)
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.replace('v', '').split('.').map(Number);
    const parts2 = v2.replace('v', '').split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }

    return 0;
  }

  /**
   * Normalize platform name for Tauri
   */
  private normalizePlatform(platform: string): string {
    // Tauri sends platform like: windows-x86_64, darwin-aarch64, linux-x86_64
    return platform.toLowerCase();
  }
}
