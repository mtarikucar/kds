import { IsString, IsNotEmpty, IsOptional, IsEnum, IsInt, Min } from 'class-validator';

export enum ActivityType {
  CALL = 'CALL',
  VISIT = 'VISIT',
  NOTE = 'NOTE',
  EMAIL = 'EMAIL',
  WHATSAPP = 'WHATSAPP',
  STATUS_CHANGE = 'STATUS_CHANGE',
  DEMO = 'DEMO',
  MEETING = 'MEETING',
}

export enum ActivityOutcome {
  POSITIVE = 'POSITIVE',
  NEGATIVE = 'NEGATIVE',
  NEUTRAL = 'NEUTRAL',
  NO_ANSWER = 'NO_ANSWER',
}

export class CreateActivityDto {
  @IsEnum(ActivityType)
  type: ActivityType;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ActivityOutcome)
  outcome?: ActivityOutcome;

  @IsOptional()
  @IsInt()
  @Min(0)
  duration?: number;
}
