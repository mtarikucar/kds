import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CreateLeadDto } from './create-lead.dto';

export enum LeadStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  NOT_REACHABLE = 'NOT_REACHABLE',
  MEETING_DONE = 'MEETING_DONE',
  DEMO_SCHEDULED = 'DEMO_SCHEDULED',
  OFFER_SENT = 'OFFER_SENT',
  WAITING = 'WAITING',
  WON = 'WON',
  LOST = 'LOST',
}

export class UpdateLeadDto extends PartialType(CreateLeadDto) {
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsString()
  lostReason?: string;
}
