import { IsString, IsOptional, IsEmail, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EmptyStringToUndefined } from '../../../common/dto/transforms';

export class UpdateProfileDto {
  @ApiProperty({ example: 'John', required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(2)
  firstName?: string;

  @ApiProperty({ example: 'Doe', required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(2)
  lastName?: string;

  @ApiProperty({ example: '+1234567890', required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Phone number must be in valid international format' })
  phone?: string;
}

export class UpdateEmailDto {
  @ApiProperty({ example: 'newemail@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'CurrentPassword123!' })
  @IsString()
  @MinLength(8)
  currentPassword: string;
}
