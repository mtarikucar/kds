import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EmptyStringToUndefined } from '../../../common/dto/transforms';

// Reject CRLF in any field that flows into SMTP headers (`to:`, `subject:`
// interpolation). Without this a submitted `name = "Foo\r\nBcc: victim@x"`
// would splice an extra header into the outbound envelope.
const NO_CRLF = /^[^\r\n]*$/;

export class CreateContactDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  @Matches(NO_CRLF, { message: 'name must not contain line breaks' })
  name: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  @MaxLength(254)
  @Matches(NO_CRLF, { message: 'email must not contain line breaks' })
  email: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[+0-9 \-()]+$/, { message: 'phone must contain only digits, spaces, +, -, ()' })
  phone?: string;

  @ApiProperty({ example: 'I would like to know more about your POS system.' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  message: string;

  /**
   * Honeypot field — real users leave it blank, naive spam bots auto-fill
   * anything named "website" / "url". Hidden in the HTML form via CSS.
   * Any non-empty value makes the endpoint accept-and-ignore the submission.
   */
  @ApiPropertyOptional({ description: 'Honeypot — must be empty' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  website?: string;
}
