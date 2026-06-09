import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  // JWTs are ~500-1000 chars in practice. 4096 leaves headroom for
  // future claims while bounding parser work on pathological inputs.
  // Same cap as the superadmin refresh DTO (iter-47).
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  refreshToken: string;
}
