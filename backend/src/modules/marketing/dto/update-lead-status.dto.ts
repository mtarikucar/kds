import { IsEnum, IsOptional, IsString } from 'class-validator';
import { LeadStatus } from './update-lead.dto';

export class UpdateLeadStatusDto {
  @IsEnum(LeadStatus)
  status: LeadStatus;

  @IsOptional()
  @IsString()
  lostReason?: string;
}
