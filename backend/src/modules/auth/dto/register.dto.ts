import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsEnum, IsNotEmpty } from 'class-validator';
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

  @ApiProperty({ enum: UserRole, example: UserRole.WAITER })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiProperty({ example: 'tenant-uuid' })
  @IsString()
  @IsNotEmpty()
  tenantId: string;
}
