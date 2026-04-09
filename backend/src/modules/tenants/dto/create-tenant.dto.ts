import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateTenantDto {
  @ApiProperty({ example: 'Restaurant ABC' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'restaurant-abc', required: false })
  @IsString()
  @IsOptional()
  subdomain?: string;
}
