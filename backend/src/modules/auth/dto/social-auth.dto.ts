import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GoogleAuthDto {
  @ApiProperty({
    description: 'Google ID token (credential) from frontend Google Sign-In',
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  credential: string;
}

export class AppleAuthDto {
  @ApiProperty({
    description: 'Apple identity token from Sign in with Apple',
    example: 'eyJraWQiOiJXNldjT0tCIiwiYWxnIjoiUlMyNTYifQ...',
  })
  @IsString()
  identityToken: string;

  @ApiPropertyOptional({
    description: 'User first name (only provided on first sign-in with Apple)',
    example: 'John',
  })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({
    description: 'User last name (only provided on first sign-in with Apple)',
    example: 'Doe',
  })
  @IsOptional()
  @IsString()
  lastName?: string;
}
