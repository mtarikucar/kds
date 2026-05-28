import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsEnum, IsNotEmpty, IsOptional, Matches, IsUUID, MaxLength } from 'class-validator';
import { UserRole } from '../../../common/constants/roles.enum';
import { EmptyStringToUndefined } from '../../../common/dto/transforms';

export class RegisterDto {
  @ApiProperty({ example: 'admin@restaurant.com' })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254) // RFC 5321
  email: string;

  // 128-char cap defends against bcryptjs CPU-DoS — see LoginDto.
  // Above bcrypt's 72-byte truncation point so legitimate strong
  // passwords still work.
  @ApiProperty({ example: 'Passw0rd!', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one lowercase letter, one uppercase letter, and one digit',
  })
  password: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ enum: UserRole, example: UserRole.ADMIN, required: false })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @ApiProperty({ example: 'My Restaurant', required: false })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(120)
  restaurantName?: string;

  @ApiProperty({ example: 'tenant-uuid', required: false })
  @EmptyStringToUndefined()
  @IsUUID()
  @IsOptional()
  tenantId?: string;
}
