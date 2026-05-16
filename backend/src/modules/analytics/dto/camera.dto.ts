import { IsString, IsOptional, IsEnum, IsNumber, IsObject, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CameraStreamType, CameraStatus } from '../enums/analytics.enum';
import { EmptyStringToNumber } from '../../../common/dto/transforms';

export class CreateCameraDto {
  @ApiProperty({ description: 'Camera name', example: 'Main Entrance Camera' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Camera description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Stream URL (RTSP/ONVIF)', example: 'rtsp://admin:password@192.168.1.100:554/stream1' })
  @IsString()
  streamUrl: string;

  @ApiPropertyOptional({
    description: 'Stream type',
    enum: CameraStreamType,
    default: CameraStreamType.RTSP
  })
  @IsEnum(CameraStreamType)
  @IsOptional()
  streamType?: CameraStreamType;

  @ApiPropertyOptional({ description: 'Horizontal rotation in degrees', default: 0, minimum: 0, maximum: 360 })
  @EmptyStringToNumber()
  @IsNumber()
  @Min(0)
  @Max(360)
  @IsOptional()
  rotationY?: number;

  @ApiPropertyOptional({ description: 'Field of view in degrees', default: 90, minimum: 30, maximum: 180 })
  @EmptyStringToNumber()
  @IsNumber()
  @Min(30)
  @Max(180)
  @IsOptional()
  fov?: number;

  @ApiPropertyOptional({ description: 'Floor plan calibration data' })
  @IsObject()
  @IsOptional()
  calibrationData?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Edge device ID for processing' })
  @IsString()
  @IsOptional()
  edgeDeviceId?: string;
}

export class UpdateCameraDto {
  @ApiPropertyOptional({ description: 'Camera name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Camera description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Stream URL' })
  @IsString()
  @IsOptional()
  streamUrl?: string;

  @ApiPropertyOptional({ enum: CameraStreamType })
  @IsEnum(CameraStreamType)
  @IsOptional()
  streamType?: CameraStreamType;

  @ApiPropertyOptional({ enum: CameraStatus })
  @IsEnum(CameraStatus)
  @IsOptional()
  status?: CameraStatus;

  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsNumber()
  @Min(0)
  @Max(360)
  @IsOptional()
  rotationY?: number;

  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsNumber()
  @Min(30)
  @Max(180)
  @IsOptional()
  fov?: number;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  calibrationData?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  edgeDeviceId?: string;
}

export class CameraResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  streamUrl: string;

  @ApiProperty({ enum: CameraStreamType })
  streamType: CameraStreamType;

  @ApiProperty({ enum: CameraStatus })
  status: CameraStatus;

  @ApiPropertyOptional()
  rotationY?: number;

  @ApiPropertyOptional()
  fov?: number;

  @ApiPropertyOptional()
  calibrationData?: Record<string, unknown>;

  @ApiPropertyOptional()
  lastSeenAt?: Date;

  @ApiPropertyOptional()
  errorMessage?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
