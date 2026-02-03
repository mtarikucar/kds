import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsEnum,
  ValidateNested,
  IsDateString,
  Min,
  Max,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

// Enums
export enum PersonState {
  STANDING = 'STANDING',
  SITTING = 'SITTING',
  MOVING = 'MOVING',
  WAITING = 'WAITING',
  UNKNOWN = 'UNKNOWN',
}

export enum EdgeDeviceStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  ERROR = 'ERROR',
  UPDATING = 'UPDATING',
}

// Edge Device Registration
export class EdgeDeviceRegisterDto {
  @IsString()
  deviceId: string;

  @IsString()
  tenantId: string;

  @IsString()
  cameraId: string;

  @IsDateString()
  timestamp: string;

  @IsOptional()
  @IsString()
  firmwareVersion?: string;

  @IsOptional()
  @IsString()
  hardwareType?: string;

  @IsOptional()
  @IsObject()
  capabilities?: {
    yolov8?: boolean;
    pose?: boolean;
    tracking?: boolean;
    gpuAccel?: boolean;
  };
}

// Detection Data
export class DetectionDto {
  @IsString()
  trackingId: string;

  @IsNumber()
  positionX: number;

  @IsNumber()
  positionZ: number;

  @IsNumber()
  @Min(0)
  @Max(19)
  gridX: number;

  @IsNumber()
  @Min(0)
  @Max(19)
  gridZ: number;

  @IsEnum(PersonState)
  state: PersonState;

  @IsNumber()
  @Min(0)
  @Max(1)
  confidence: number;

  @IsOptional()
  @IsNumber()
  velocityX?: number;

  @IsOptional()
  @IsNumber()
  velocityZ?: number;
}

// Occupancy Data from Edge Device
export class EdgeOccupancyDataDto {
  @IsString()
  cameraId: string;

  @IsString()
  tenantId: string;

  @IsDateString()
  timestamp: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetectionDto)
  detections: DetectionDto[];
}

// Heartbeat
export class EdgeHeartbeatDto {
  @IsString()
  deviceId: string;

  @IsDateString()
  timestamp: string;
}

// Health Status
export class EdgeHealthStatusDto {
  @IsString()
  deviceId: string;

  @IsDateString()
  timestamp: string;

  @IsNumber()
  @IsOptional()
  uptime?: number;

  @IsNumber()
  @IsOptional()
  framesProcessed?: number;

  @IsNumber()
  @IsOptional()
  detectionsTotal?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  cpuUsage?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  memoryUsage?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  gpuUsage?: number;

  @IsNumber()
  @IsOptional()
  temperature?: number;

  @IsNumber()
  @IsOptional()
  fps?: number;

  @IsOptional()
  @IsObject()
  camera?: {
    state?: string;
    url?: string;
    reconnectCount?: number;
    actualFps?: number;
    lastFrame?: string;
  };

  @IsOptional()
  @IsObject()
  tracker?: {
    activeTracks?: number;
    totalTracked?: number;
  };
}

// Calibration Data
export class CalibrationPointDto {
  @IsNumber()
  imageX: number;

  @IsNumber()
  imageY: number;

  @IsNumber()
  floorX: number;

  @IsNumber()
  floorZ: number;
}

export class CameraCalibrationDto {
  @IsString()
  cameraId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CalibrationPointDto)
  points: CalibrationPointDto[];

  @IsOptional()
  @IsArray()
  homographyMatrix?: number[][];
}

// Edge Device Configuration (sent to device)
export class EdgeDeviceConfigDto {
  @IsString()
  cameraId: string;

  @IsOptional()
  @IsString()
  cameraUrl?: string;

  @IsOptional()
  @IsNumber()
  fps?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidenceThreshold?: number;

  @IsOptional()
  @IsObject()
  calibration?: {
    homographyMatrix?: number[][];
    floorPlanWidth?: number;
    floorPlanHeight?: number;
    gridSize?: number;
  };
}

// Edge Device Command (sent to device)
export class EdgeDeviceCommandDto {
  @IsString()
  command: 'START' | 'STOP' | 'RESTART' | 'RECALIBRATE' | 'UPDATE_CONFIG';

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}
