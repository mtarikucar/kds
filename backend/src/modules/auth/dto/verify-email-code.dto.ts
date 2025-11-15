import { IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailCodeDto {
  @ApiProperty({
    description: '6 haneli email doğrulama kodu',
    example: '123456',
    minLength: 6,
    maxLength: 6,
    pattern: '^\\d{6}$',
  })
  @IsString()
  @Length(6, 6, { message: 'Kod 6 haneli olmalıdır' })
  @Matches(/^\d{6}$/, { message: 'Kod sadece rakamlardan oluşmalıdır' })
  code: string;
}
