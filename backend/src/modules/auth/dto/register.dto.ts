import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { UserRole } from '../../../common/constants/roles.enum';

export class RegisterDto {
  @ApiProperty({ example: 'admin@restaurant.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ enum: UserRole, example: UserRole.ADMIN, required: false })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @ApiProperty({ example: 'My Restaurant', required: false })
  @IsString()
  @IsOptional()
  restaurantName?: string;

  @ApiProperty({ example: 'tenant-uuid', required: false })
  @IsString()
  @IsOptional()
  tenantId?: string;

  @ApiProperty({ example: 'INTERNATIONAL', enum: ['TURKEY', 'INTERNATIONAL'], required: false })
  @IsString()
  @IsOptional()
  paymentRegion?: string;
}
