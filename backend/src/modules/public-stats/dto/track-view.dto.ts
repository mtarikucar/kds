import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TrackViewDto {
  @ApiProperty({ description: 'Page name', example: 'landing' })
  @IsString()
  @MaxLength(100)
  page: string;

  @ApiProperty({ description: 'Full URL path', example: '/' })
  @IsString()
  @MaxLength(500)
  path: string;

  @ApiPropertyOptional({ description: 'Referrer URL' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  referrer?: string;

  @ApiPropertyOptional({ description: 'Session ID for tracking' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sessionId?: string;
}
