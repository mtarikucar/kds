import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class CreateSwapRequestDto {
  @ApiProperty()
  @IsString()
  targetId: string;

  @ApiProperty()
  @IsString()
  requesterAssignmentId: string;

  @ApiProperty()
  @IsString()
  targetAssignmentId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
