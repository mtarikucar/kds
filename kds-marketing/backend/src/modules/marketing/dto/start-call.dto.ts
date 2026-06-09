import { IsString, IsNotEmpty, IsOptional, IsUUID, MaxLength, Matches } from 'class-validator';

export class StartCallDto {
  /** The number to dial (customer/lead). Loosely validated — telephony normalises. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(25)
  @Matches(/^[+0-9 ()-]+$/, { message: 'toPhone must be a phone number' })
  toPhone!: string;

  /** Optional lead this call is about — mirrors the outcome onto the lead timeline. */
  @IsOptional()
  @IsUUID()
  leadId?: string;
}
