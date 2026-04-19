import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsInt,
  IsEnum,
  IsDateString,
  Min,
} from 'class-validator';

export enum BusinessType {
  CAFE = 'CAFE',
  RESTAURANT = 'RESTAURANT',
  BAR = 'BAR',
  PATISSERIE = 'PATISSERIE',
  FAST_FOOD = 'FAST_FOOD',
  OTHER = 'OTHER',
}

export enum LeadSource {
  INSTAGRAM = 'INSTAGRAM',
  REFERRAL = 'REFERRAL',
  FIELD_VISIT = 'FIELD_VISIT',
  ADS = 'ADS',
  WEBSITE = 'WEBSITE',
  PHONE = 'PHONE',
  OTHER = 'OTHER',
}

export enum LeadPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  businessName: string;

  @IsString()
  @IsNotEmpty()
  contactPerson: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsEnum(BusinessType)
  businessType: BusinessType;

  @IsOptional()
  @IsInt()
  @Min(0)
  tableCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  branchCount?: number;

  @IsOptional()
  @IsString()
  currentSystem?: string;

  @IsEnum(LeadSource)
  source: LeadSource;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  nextFollowUp?: string;

  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}
