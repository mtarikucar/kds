import { IsString, IsOptional, IsEnum, IsArray, IsNumber, IsObject, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InsightType, InsightCategory, InsightSeverity, InsightStatus } from '../enums/analytics.enum';

export class UpdateInsightStatusDto {
  @ApiProperty({ enum: InsightStatus, description: 'New status for the insight' })
  @IsEnum(InsightStatus)
  status: InsightStatus;

  @ApiPropertyOptional({ description: 'Reason for dismissing (required if status is DISMISSED)' })
  @IsString()
  @IsOptional()
  dismissedReason?: string;
}

export class InsightFilterDto {
  @ApiPropertyOptional({ enum: InsightType, description: 'Filter by insight type' })
  @IsEnum(InsightType)
  @IsOptional()
  type?: InsightType;

  @ApiPropertyOptional({ enum: InsightCategory, description: 'Filter by category' })
  @IsEnum(InsightCategory)
  @IsOptional()
  category?: InsightCategory;

  @ApiPropertyOptional({ enum: InsightSeverity, description: 'Filter by severity' })
  @IsEnum(InsightSeverity)
  @IsOptional()
  severity?: InsightSeverity;

  @ApiPropertyOptional({ enum: InsightStatus, description: 'Filter by status' })
  @IsEnum(InsightStatus)
  @IsOptional()
  status?: InsightStatus;

  @ApiPropertyOptional({ description: 'Number of insights to return', default: 20 })
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ description: 'Number of insights to skip', default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  offset?: number;
}

export class InsightResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: InsightType })
  type: InsightType;

  @ApiProperty({ enum: InsightCategory })
  category: InsightCategory;

  @ApiProperty({ enum: InsightSeverity })
  severity: InsightSeverity;

  @ApiProperty()
  title: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  recommendation: string;

  @ApiPropertyOptional({ type: [String] })
  affectedTableIds?: string[];

  @ApiPropertyOptional()
  affectedAreaData?: Record<string, unknown>;

  @ApiPropertyOptional()
  supportingData?: Record<string, unknown>;

  @ApiPropertyOptional()
  potentialImpact?: string;

  @ApiProperty()
  confidenceScore: number;

  @ApiProperty({ enum: InsightStatus })
  status: InsightStatus;

  @ApiPropertyOptional()
  reviewedAt?: Date;

  @ApiPropertyOptional()
  implementedAt?: Date;

  @ApiPropertyOptional()
  dismissedReason?: string;

  @ApiProperty()
  validFrom: Date;

  @ApiPropertyOptional()
  validUntil?: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class InsightListResponseDto {
  @ApiProperty({ type: [InsightResponseDto] })
  insights: InsightResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  offset: number;
}
