import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum CancelMode {
  IMMEDIATE = 'IMMEDIATE',
  AT_PERIOD_END = 'AT_PERIOD_END',
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional({
    enum: CancelMode,
    default: CancelMode.AT_PERIOD_END,
    description:
      'IMMEDIATE flips status=CANCELLED right now; AT_PERIOD_END lets the ' +
      'subscription run until currentPeriodEnd before transitioning',
  })
  @IsOptional()
  @IsEnum(CancelMode)
  mode?: CancelMode = CancelMode.AT_PERIOD_END;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
