import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export enum TenantPlan {
  FREE = 'FREE',
  BASIC = 'BASIC',
  PREMIUM = 'PREMIUM',
}

export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}

export class CreateTenantDto {
  @ApiProperty({ example: 'Restaurant ABC' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'restaurant-abc', required: false })
  @IsString()
  @IsOptional()
  subdomain?: string;

  @ApiProperty({ enum: TenantPlan, example: TenantPlan.FREE, default: TenantPlan.FREE })
  @IsEnum(TenantPlan)
  @IsOptional()
  plan?: TenantPlan;

  @ApiProperty({ enum: TenantStatus, example: TenantStatus.ACTIVE, default: TenantStatus.ACTIVE })
  @IsEnum(TenantStatus)
  @IsOptional()
  status?: TenantStatus;
}
