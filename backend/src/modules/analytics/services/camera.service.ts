import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CameraStatus } from '../enums/analytics.enum';
import { CreateCameraDto, UpdateCameraDto, CameraResponseDto } from '../dto';

@Injectable()
export class CameraService {
  private readonly logger = new Logger(CameraService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create a new camera
   */
  async createCamera(tenantId: string, dto: CreateCameraDto): Promise<CameraResponseDto> {
    // Check for duplicate name
    const existing = await this.prisma.camera.findFirst({
      where: {
        tenantId,
        name: dto.name,
      },
    });

    if (existing) {
      throw new ConflictException(`Camera with name "${dto.name}" already exists`);
    }

    const camera = await this.prisma.camera.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        streamUrl: dto.streamUrl,
        streamType: dto.streamType || 'RTSP',
        voxelX: dto.voxelX,
        voxelY: dto.voxelY ?? 2.5,
        voxelZ: dto.voxelZ,
        rotationY: dto.rotationY ?? 0,
        fov: dto.fov ?? 90,
        calibrationData: dto.calibrationData as Prisma.InputJsonValue | undefined,
        edgeDeviceId: dto.edgeDeviceId,
        status: CameraStatus.OFFLINE,
      },
    });

    this.logger.log(`Created camera "${dto.name}" for tenant ${tenantId}`);
    return this.mapToResponseDto(camera);
  }

  /**
   * Get all cameras for a tenant
   */
  async getCameras(tenantId: string): Promise<CameraResponseDto[]> {
    const cameras = await this.prisma.camera.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });

    return cameras.map(this.mapToResponseDto);
  }

  /**
   * Get a single camera by ID
   */
  async getCameraById(tenantId: string, cameraId: string): Promise<CameraResponseDto> {
    const camera = await this.prisma.camera.findFirst({
      where: {
        id: cameraId,
        tenantId,
      },
    });

    if (!camera) {
      throw new NotFoundException(`Camera with ID ${cameraId} not found`);
    }

    return this.mapToResponseDto(camera);
  }

  /**
   * Update a camera
   */
  async updateCamera(
    tenantId: string,
    cameraId: string,
    dto: UpdateCameraDto
  ): Promise<CameraResponseDto> {
    const camera = await this.prisma.camera.findFirst({
      where: {
        id: cameraId,
        tenantId,
      },
    });

    if (!camera) {
      throw new NotFoundException(`Camera with ID ${cameraId} not found`);
    }

    // Check for duplicate name if name is being changed
    if (dto.name && dto.name !== camera.name) {
      const existing = await this.prisma.camera.findFirst({
        where: {
          tenantId,
          name: dto.name,
          id: { not: cameraId },
        },
      });

      if (existing) {
        throw new ConflictException(`Camera with name "${dto.name}" already exists`);
      }
    }

    const updated = await this.prisma.camera.update({
      where: { id: cameraId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.streamUrl !== undefined && { streamUrl: dto.streamUrl }),
        ...(dto.streamType !== undefined && { streamType: dto.streamType }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.voxelX !== undefined && { voxelX: dto.voxelX }),
        ...(dto.voxelY !== undefined && { voxelY: dto.voxelY }),
        ...(dto.voxelZ !== undefined && { voxelZ: dto.voxelZ }),
        ...(dto.rotationY !== undefined && { rotationY: dto.rotationY }),
        ...(dto.fov !== undefined && { fov: dto.fov }),
        ...(dto.calibrationData !== undefined && { calibrationData: dto.calibrationData as Prisma.InputJsonValue }),
        ...(dto.edgeDeviceId !== undefined && { edgeDeviceId: dto.edgeDeviceId }),
      },
    });

    this.logger.log(`Updated camera ${cameraId}`);
    return this.mapToResponseDto(updated);
  }

  /**
   * Delete a camera
   */
  async deleteCamera(tenantId: string, cameraId: string): Promise<void> {
    const camera = await this.prisma.camera.findFirst({
      where: {
        id: cameraId,
        tenantId,
      },
    });

    if (!camera) {
      throw new NotFoundException(`Camera with ID ${cameraId} not found`);
    }

    await this.prisma.camera.delete({
      where: { id: cameraId },
    });

    this.logger.log(`Deleted camera ${cameraId}`);
  }

  /**
   * Update camera status (called by edge device)
   */
  async updateCameraStatus(
    cameraId: string,
    status: CameraStatus,
    errorMessage?: string
  ): Promise<void> {
    await this.prisma.camera.update({
      where: { id: cameraId },
      data: {
        status,
        lastSeenAt: status === CameraStatus.ONLINE ? new Date() : undefined,
        errorMessage: errorMessage || null,
      },
    });
  }

  /**
   * Get cameras by status
   */
  async getCamerasByStatus(tenantId: string, status: CameraStatus): Promise<CameraResponseDto[]> {
    const cameras = await this.prisma.camera.findMany({
      where: {
        tenantId,
        status,
      },
    });

    return cameras.map(this.mapToResponseDto);
  }

  /**
   * Update camera calibration data
   */
  async updateCalibration(
    tenantId: string,
    cameraId: string,
    calibrationData: Record<string, unknown>
  ): Promise<CameraResponseDto> {
    const camera = await this.prisma.camera.findFirst({
      where: {
        id: cameraId,
        tenantId,
      },
    });

    if (!camera) {
      throw new NotFoundException(`Camera with ID ${cameraId} not found`);
    }

    const updated = await this.prisma.camera.update({
      where: { id: cameraId },
      data: {
        calibrationData: calibrationData as Prisma.InputJsonValue,
        status: CameraStatus.CALIBRATING,
      },
    });

    this.logger.log(`Updated calibration for camera ${cameraId}`);
    return this.mapToResponseDto(updated);
  }

  /**
   * Get camera health summary
   */
  async getCameraHealthSummary(tenantId: string): Promise<{
    total: number;
    online: number;
    offline: number;
    error: number;
    calibrating: number;
  }> {
    const statusCounts = await this.prisma.camera.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: true,
    });

    const counts = {
      total: 0,
      online: 0,
      offline: 0,
      error: 0,
      calibrating: 0,
    };

    for (const item of statusCounts) {
      counts.total += item._count;
      switch (item.status) {
        case CameraStatus.ONLINE:
          counts.online = item._count;
          break;
        case CameraStatus.OFFLINE:
          counts.offline = item._count;
          break;
        case CameraStatus.ERROR:
          counts.error = item._count;
          break;
        case CameraStatus.CALIBRATING:
          counts.calibrating = item._count;
          break;
      }
    }

    return counts;
  }

  // Private helper methods

  private mapToResponseDto(camera: {
    id: string;
    name: string;
    description: string | null;
    streamUrl: string;
    streamType: string;
    status: string;
    voxelX: number | null;
    voxelY: number | null;
    voxelZ: number | null;
    rotationY: number | null;
    fov: number | null;
    calibrationData: unknown;
    lastSeenAt: Date | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): CameraResponseDto {
    return {
      id: camera.id,
      name: camera.name,
      description: camera.description || undefined,
      streamUrl: camera.streamUrl,
      streamType: camera.streamType as CameraResponseDto['streamType'],
      status: camera.status as CameraResponseDto['status'],
      voxelX: camera.voxelX || undefined,
      voxelY: camera.voxelY || undefined,
      voxelZ: camera.voxelZ || undefined,
      rotationY: camera.rotationY || undefined,
      fov: camera.fov || undefined,
      calibrationData: camera.calibrationData as Record<string, unknown> | undefined,
      lastSeenAt: camera.lastSeenAt || undefined,
      errorMessage: camera.errorMessage || undefined,
      createdAt: camera.createdAt,
      updatedAt: camera.updatedAt,
    };
  }
}
