import { IsString, IsOptional, IsIn } from 'class-validator';

const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'NOT_REACHABLE',
  'MEETING_DONE',
  'DEMO_SCHEDULED',
  'OFFER_SENT',
  'WAITING',
  'WON',
  'LOST',
] as const;

export class UpdateLeadStatusDto {
  @IsString()
  @IsIn(LEAD_STATUSES)
  status: string;

  @IsOptional()
  @IsString()
  lostReason?: string;
}
