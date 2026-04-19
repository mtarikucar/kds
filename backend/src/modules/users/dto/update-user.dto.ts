import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../../common/constants/roles.enum';

/**
 * Status transitions deliberately live on dedicated endpoints
 * (/approve, /reject, /reactivate, DELETE /:id). This DTO intentionally
 * does not accept `status` so mass-assignment cannot flip an INACTIVE
 * user back to ACTIVE or vice-versa through the generic update path.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'user@restaurant.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'Passw0rd!' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Password must contain at least one lowercase letter, one uppercase letter, and one digit',
  })
  password?: string;

  @ApiPropertyOptional({ example: 'John' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
