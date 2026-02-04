import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SuperAdminLoginDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'securepassword123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;
}

export class SuperAdminLoginResponseDto {
  @ApiProperty()
  requiresTwoFactor: boolean;

  @ApiProperty({ required: false })
  requires2FASetup?: boolean;

  @ApiProperty({ required: false })
  tempToken?: string;

  @ApiProperty({ required: false })
  accessToken?: string;

  @ApiProperty({ required: false })
  refreshToken?: string;

  @ApiProperty({ required: false })
  superAdmin?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}
