import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength, Matches, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { UserRole } from '../../../common/constants/roles.enum';

export class RegisterDto {
  @ApiProperty({ example: 'admin@restaurant.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'Password1', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one digit',
  })
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
