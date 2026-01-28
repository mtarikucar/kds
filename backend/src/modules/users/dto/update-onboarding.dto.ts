import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class TourProgressDto {
  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  completed?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  lastStep?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  completedAt?: string;
}

export class UpdateOnboardingDto {
  @ApiProperty({
    description: 'Whether the user has seen the welcome modal',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  hasSeenWelcome?: boolean;

  @ApiProperty({
    description: 'Tour progress for each tour type',
    required: false,
  })
  @IsObject()
  @IsOptional()
  tourProgress?: Record<string, TourProgressDto>;

  @ApiProperty({
    description: 'Skip all tours flag',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  skipAllTours?: boolean;
}

export class OnboardingDataResponse {
  @ApiProperty()
  hasSeenWelcome: boolean;

  @ApiProperty()
  tourProgress: Record<string, TourProgressDto>;

  @ApiProperty()
  skipAllTours: boolean;
}
