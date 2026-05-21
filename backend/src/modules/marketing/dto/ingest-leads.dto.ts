import {
  IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested,
  IsString, IsNotEmpty, IsOptional, IsEnum, IsEmail, IsUrl, IsInt, Min,
  Matches, MaxLength, IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BusinessType, LeadPriority } from './create-lead.dto';

export class IngestLeadCandidateDto {
  @IsString()
  @Matches(/^(phone:\+90\d{10}|instagram:@[A-Za-z0-9_.]{1,30}|google:[A-Za-z0-9_-]{20,}|hash:[a-f0-9]{40})$/, {
    message: 'externalRef must match phone:|instagram:|google:|hash: pattern',
  })
  externalRef: string;

  @IsString() @IsNotEmpty() @MaxLength(255)
  businessName: string;

  @IsOptional() @IsString() @MaxLength(120)
  city?: string;

  @IsOptional() @IsString() @MaxLength(120)
  region?: string;

  @IsEnum(BusinessType)
  businessType: BusinessType;

  @IsOptional() @Matches(/^\+90\d{10}$/)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(60)
  instagram?: string;

  @IsOptional() @IsUrl()
  website?: string;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsInt() @Min(0)
  branchCount?: number;

  @IsOptional() @IsString() @MaxLength(120)
  currentSystem?: string;

  @IsOptional() @IsIn(['GROWING', 'STRUGGLING', 'STABLE'])
  stage?: string;

  @IsOptional() @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @IsString() @IsNotEmpty() @MaxLength(1000)
  painPoint: string;

  @IsString() @IsNotEmpty() @MaxLength(500)
  evidence: string;

  @IsString() @IsNotEmpty() @MaxLength(500)
  pitch: string;
}

export class IngestLeadsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => IngestLeadCandidateDto)
  leads: IngestLeadCandidateDto[];
}
