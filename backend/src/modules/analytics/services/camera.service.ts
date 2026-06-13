import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { CameraStatus } from "../enums/analytics.enum";
import { CreateCameraDto, UpdateCameraDto, CameraResponseDto } from "../dto";
import {
  decryptString,
  encryptString,
} from "../../../common/helpers/encryption.helper";
import {
  BranchScope,
  branchScope,
} from "../../../common/scoping/branch-scope";

/**
 * Replace `user:pass` in an RTSP/ONVIF URL with `***:***` so responses
 * to the tenant admin UI don't leak NVR credentials. The plaintext
 * still lives (encrypted) on disk for the edge device to use.
 */
function redactStreamUrl(url: string): string {
  try {
    return url.replace(/(:\/\/)[^:/@]+:[^@]+@/, "$1***:***@");
  } catch {
    return url;
  }
}

@Injectable()
export class CameraService {
  private readonly logger = new Logger(CameraService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create a new camera
   */
  async createCamera(
    scope: BranchScope,
    dto: CreateCameraDto,
  ): Promise<CameraResponseDto> {
    const { tenantId } = scope;
    // Check for duplicate name
    const existing = await this.prisma.camera.findFirst({
      where: {
        tenantId,
        name: dto.name,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Camera with name "${dto.name}" already exists`,
      );
    }

    // v3.0.0 — every operational row carries branchId. Derive from the
    // referenced edge device so a camera always lives in the same
    // branch as its host device. The WRITTEN branchId is the device's
    // home branch (correct write-path derivation), not the acting
    // scope's branch.
    const edgeDevice = await this.prisma.edgeDevice.findFirst({
      where: { id: dto.edgeDeviceId, tenantId },
      select: { branchId: true },
    });
    if (!edgeDevice) {
      throw new NotFoundException(
        `Edge device with ID ${dto.edgeDeviceId} not found`,
      );
    }

    const camera = await this.prisma.camera.create({
      data: {
        tenantId,
        branchId: edgeDevice.branchId,
        name: dto.name,
        description: dto.description,
        // Encrypted at rest; the edge device's config fetch decrypts on
        // the fly. Only the redacted form flows back to the admin UI.
        streamUrl: encryptString(dto.streamUrl),
        streamType: dto.streamType || "RTSP",
        rotationY: dto.rotationY ?? 0,
        fov: dto.fov ?? 90,
        calibrationData: dto.calibrationData as
          | Prisma.InputJsonValue
          | undefined,
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
  async getCameras(scope: BranchScope): Promise<CameraResponseDto[]> {
    const cameras = await this.prisma.camera.findMany({
      where: { ...branchScope(scope) },
      orderBy: { name: "asc" },
    });

    return cameras.map(this.mapToResponseDto);
  }

  /**
   * Get a single camera by ID
   */
  async getCameraById(
    scope: BranchScope,
    cameraId: string,
  ): Promise<CameraResponseDto> {
    const camera = await this.prisma.camera.findFirst({
      where: {
        id: cameraId,
        ...branchScope(scope),
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
    scope: BranchScope,
    cameraId: string,
    dto: UpdateCameraDto,
  ): Promise<CameraResponseDto> {
    const { tenantId } = scope;
    const camera = await this.prisma.camera.findFirst({
      where: {
        id: cameraId,
        ...branchScope(scope),
      },
    });

    if (!camera) {
      throw new NotFoundException(`Camera with ID ${cameraId} not found`);
    }

    // Check for duplicate name if name is being changed. Names are unique
    // per tenant, so the dedupe stays tenant-scoped.
    if (dto.name && dto.name !== camera.name) {
      const existing = await this.prisma.camera.findFirst({
        where: {
          tenantId,
          name: dto.name,
          id: { not: cameraId },
        },
      });

      if (existing) {
        throw new ConflictException(
          `Camera with name "${dto.name}" already exists`,
        );
      }
    }

    // Defence-in-depth: full branch scope in the WHERE (B41-B45 pattern).
    const claim = await this.prisma.camera.updateMany({
      where: { id: cameraId, ...branchScope(scope) },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.streamUrl !== undefined && {
          streamUrl: encryptString(dto.streamUrl),
        }),
        ...(dto.streamType !== undefined && { streamType: dto.streamType }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.rotationY !== undefined && { rotationY: dto.rotationY }),
        ...(dto.fov !== undefined && { fov: dto.fov }),
        ...(dto.calibrationData !== undefined && {
          calibrationData: dto.calibrationData as Prisma.InputJsonValue,
        }),
        ...(dto.edgeDeviceId !== undefined && {
          edgeDeviceId: dto.edgeDeviceId,
        }),
      },
    });
    if (claim.count === 0) {
      throw new NotFoundException(`Camera with ID ${cameraId} not found`);
    }
    // v2.8.94 — defense-in-depth: compound WHERE matches the upstream
    // claim. If the claim regresses, the re-fetch must not silently
    // expose a cross-branch row.
    const updated = await this.prisma.camera.findFirstOrThrow({
      where: { id: cameraId, ...branchScope(scope) },
    });

    this.logger.log(`Updated camera ${cameraId}`);
    return this.mapToResponseDto(updated);
  }

  /**
   * Delete a camera
   */
  async deleteCamera(scope: BranchScope, cameraId: string): Promise<void> {
    const camera = await this.prisma.camera.findFirst({
      where: {
        id: cameraId,
        ...branchScope(scope),
      },
    });

    if (!camera) {
      throw new NotFoundException(`Camera with ID ${cameraId} not found`);
    }

    // Defence-in-depth: full branch scope in the WHERE.
    await this.prisma.camera.deleteMany({
      where: { id: cameraId, ...branchScope(scope) },
    });

    this.logger.log(`Deleted camera ${cameraId}`);
  }

  /**
   * Update camera status (called by edge device). Tenant-scoped so an
   * authenticated edge device cannot forge status updates for another
   * tenant's cameras by guessing UUIDs; callers MUST pass the tenantId
   * that belongs to the device's configuration.
   */
  async updateCameraStatus(
    cameraId: string,
    tenantId: string,
    status: CameraStatus,
    errorMessage?: string,
  ): Promise<void> {
    const res = await this.prisma.camera.updateMany({
      where: { id: cameraId, tenantId },
      data: {
        status,
        lastSeenAt: status === CameraStatus.ONLINE ? new Date() : undefined,
        errorMessage: errorMessage || null,
      },
    });
    if (res.count !== 1) {
      throw new NotFoundException(`Camera with ID ${cameraId} not found`);
    }
  }

  /**
   * Get cameras by status
   */
  async getCamerasByStatus(
    tenantId: string,
    status: CameraStatus,
  ): Promise<CameraResponseDto[]> {
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
    scope: BranchScope,
    cameraId: string,
    calibrationData: Record<string, unknown>,
  ): Promise<CameraResponseDto> {
    const camera = await this.prisma.camera.findFirst({
      where: {
        id: cameraId,
        ...branchScope(scope),
      },
    });

    if (!camera) {
      throw new NotFoundException(`Camera with ID ${cameraId} not found`);
    }

    // Defence-in-depth: full branch scope in the WHERE (matches the
    // read/update/delete siblings — a branch-A admin must not calibrate
    // a branch-B camera by guessing its UUID).
    const claim = await this.prisma.camera.updateMany({
      where: { id: cameraId, ...branchScope(scope) },
      data: {
        calibrationData: calibrationData as Prisma.InputJsonValue,
        status: CameraStatus.CALIBRATING,
      },
    });
    if (claim.count === 0) {
      throw new NotFoundException(`Camera with ID ${cameraId} not found`);
    }
    // v2.8.94 — defense-in-depth: compound WHERE matches the upstream
    // claim. If the claim regresses, the re-fetch must not silently
    // expose a cross-branch row.
    const updated = await this.prisma.camera.findFirstOrThrow({
      where: { id: cameraId, ...branchScope(scope) },
    });

    this.logger.log(`Updated calibration for camera ${cameraId}`);
    return this.mapToResponseDto(updated);
  }

  /**
   * Get camera health summary
   */
  async getCameraHealthSummary(scope: BranchScope): Promise<{
    total: number;
    online: number;
    offline: number;
    error: number;
    calibrating: number;
  }> {
    const statusCounts = await this.prisma.camera.groupBy({
      by: ["status"],
      where: { ...branchScope(scope) },
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
    rotationY: number | null;
    fov: number | null;
    calibrationData: unknown;
    lastSeenAt: Date | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): CameraResponseDto {
    // The stored streamUrl is encrypted (AES-GCM). We decrypt so we
    // can build the redacted form but never return the plaintext.
    const decrypted = camera.streamUrl ? decryptString(camera.streamUrl) : "";
    return {
      id: camera.id,
      name: camera.name,
      description: camera.description || undefined,
      streamUrl: redactStreamUrl(decrypted),
      streamType: camera.streamType as CameraResponseDto["streamType"],
      status: camera.status as CameraResponseDto["status"],
      rotationY: camera.rotationY ?? undefined,
      fov: camera.fov ?? undefined,
      calibrationData: camera.calibrationData as
        | Record<string, unknown>
        | undefined,
      lastSeenAt: camera.lastSeenAt || undefined,
      errorMessage: camera.errorMessage || undefined,
      createdAt: camera.createdAt,
      updatedAt: camera.updatedAt,
    };
  }

  /**
   * Used by the edge-device config path where the plaintext stream URL
   * actually needs to reach the device. Never call from user-facing
   * endpoints.
   */
  decryptStreamUrl(encrypted: string): string {
    return decryptString(encrypted);
  }
}
