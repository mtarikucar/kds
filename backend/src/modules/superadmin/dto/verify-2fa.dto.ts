import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class Verify2FADto {
  @ApiProperty({ description: 'Temporary token from login' })
  @IsString()
  @IsNotEmpty()
  tempToken: string;

  /**
   * A 6-digit TOTP code OR a 10-char backup code. Bounded by Length so
   * the endpoint can't be abused with enormous strings.
   */
  @ApiProperty({ description: '6-digit TOTP code or 10-char backup code' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 10)
  code: string;
}

export class Setup2FAResponseDto {
  @ApiProperty()
  secret: string;

  @ApiProperty()
  qrCodeUrl: string;

  @ApiProperty()
  otpauthUrl: string;
}

export class Enable2FADto {
  @ApiProperty({ description: '6-digit TOTP code to verify setup', example: '123456' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code: string;
}

export class Disable2FADto {
  @ApiProperty({ description: 'Current account password' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  currentPassword: string;

  @ApiProperty({ description: '6-digit TOTP code or 10-char backup code' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 10)
  code: string;
}

export class RegenerateBackupCodesDto {
  @ApiProperty({ description: '6-digit TOTP code' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code: string;
}
